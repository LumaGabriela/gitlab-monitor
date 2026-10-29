"""Simulações com processos reais; PowerShell opcional via MONITOR_TEST_PWSH.

Na pasta do monitor: python3 -B -m unittest discover -s tests
Os componentes de desktop são dublês: não comprova exibição visual no SO alvo.
"""

import base64
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import gitlab_monitor as monitor


# Compila o C# de produção com um desktop simulado, sem trocar sua lógica.
# Cada modo fornece um evento nativo ou deixa o timer de segurança expirar.
FAKE_DESKTOP = r"""
namespace System.Drawing {
    public static class SystemIcons { public static object Information = new object(); }
}
namespace System.Windows.Forms {
    public enum UnhandledExceptionMode { ThrowException }
    public static class Trace {
        public static System.Collections.Generic.List<string> Events = new System.Collections.Generic.List<string>();
    }
    public class ApplicationContext : IDisposable {
        public bool Exited;
        public void ExitThread() { Exited = true; Trace.Events.Add("exit"); }
        public void Dispose() {
            Trace.Events.Add("context-disposed");
            System.IO.File.WriteAllLines(Environment.GetEnvironmentVariable("MONITOR_TEST_CAPTURE"), Trace.Events);
        }
    }
    public class NotifyIcon : IDisposable {
        public static NotifyIcon Current;
        public NotifyIcon() { Current = this; }
        public object Icon { get; set; }
        public string BalloonTipTitle { get; set; }
        public string BalloonTipText { get; set; }
        public bool Visible { get; set; }
        public event EventHandler BalloonTipClosed;
        public event EventHandler BalloonTipClicked;
        public void ShowBalloonTip(int timeout) {
            if (Environment.GetEnvironmentVariable("MONITOR_TEST_MODE") == "error")
                throw new Exception("Simulated desktop unavailable");
            Trace.Events.Add("show:" + timeout);
            Trace.Events.Add("title:" + Convert.ToBase64String(System.Text.Encoding.UTF8.GetBytes(BalloonTipTitle)));
            Trace.Events.Add("message:" + Convert.ToBase64String(System.Text.Encoding.UTF8.GetBytes(BalloonTipText)));
        }
        public void Close() { if (BalloonTipClosed != null) BalloonTipClosed(this, EventArgs.Empty); }
        public void Click() { if (BalloonTipClicked != null) BalloonTipClicked(this, EventArgs.Empty); }
        public void Dispose() { Trace.Events.Add("icon-disposed"); }
    }
    public class Timer : IDisposable {
        public static Timer Current;
        public Timer() { Current = this; }
        public int Interval { get; set; }
        public event EventHandler Tick;
        public void Start() { Trace.Events.Add("timer-start:" + Interval); }
        public void Fire() { Tick(this, EventArgs.Empty); }
        public void Dispose() { Trace.Events.Add("timer-disposed"); }
    }
    public static class Application {
        public static void SetUnhandledExceptionMode(UnhandledExceptionMode mode) { }
        public static void Run(ApplicationContext context) {
            Trace.Events.Add("loop-start");
            Timer.Current.Fire();
            Trace.Events.Add("safety-timeout:" + Timer.Current.Interval);
            string mode = Environment.GetEnvironmentVariable("MONITOR_TEST_MODE");
            if (mode == "closed") NotifyIcon.Current.Close();
            else if (mode == "clicked") NotifyIcon.Current.Click();
            else Timer.Current.Fire();
            if (!context.Exited) throw new Exception("Loop did not exit");
            Trace.Events.Add("loop-end");
        }
    }
}
"""


class LinuxProcessTests(unittest.TestCase):
    @unittest.skipIf(os.name == "nt", "Dublê de executável POSIX; contratos Windows cobertos separadamente")
    def test_notify_send_process_receives_unicode_and_reports_session_failure(self):
        with tempfile.TemporaryDirectory() as directory:
            executable = Path(directory) / "notify-send"
            capture = Path(directory) / "arguments.json"
            executable.write_text(
                "#!/usr/bin/env python3\n"
                "import json, os, sys\n"
                "from pathlib import Path\n"
                "Path(os.environ['MONITOR_TEST_CAPTURE']).write_text(json.dumps(sys.argv[1:]), encoding='utf-8')\n"
                "if os.environ.get('MONITOR_TEST_MODE') == 'no-session':\n"
                "    print('GDBus.Error: org.freedesktop.Notifications ServiceUnknown', file=sys.stderr)\n"
                "    sys.exit(1)\n", encoding="utf-8")
            executable.chmod(0o700)
            with patch.dict(os.environ, {"MONITOR_TEST_CAPTURE": str(capture), "MONITOR_TEST_MODE": "success"}), \
                 patch.object(monitor.sys, "platform", "linux"), \
                 patch.object(monitor.shutil, "which", return_value=str(executable)):
                self.assertTrue(monitor.notify("GitLab → 👍", '<b>MR</b> & $(literal)\n"aspas"'))
                arguments = json.loads(capture.read_text(encoding="utf-8"))
                self.assertEqual(arguments, ["--app-name=GitLab Monitor", "--", "GitLab → 👍",
                                             '&lt;b&gt;MR&lt;/b&gt; &amp; $(literal)\n"aspas"'])
                with patch.dict(os.environ, {"MONITOR_TEST_MODE": "no-session"}), patch.object(monitor, "log") as log:
                    self.assertFalse(monitor.notify("GitLab", "Teste"))
                    self.assertIn("ServiceUnknown", log.call_args.args[0])


PWSH = os.environ.get("MONITOR_TEST_PWSH") or shutil.which("pwsh")


@unittest.skipUnless(PWSH, "Defina MONITOR_TEST_PWSH para validar com runtime PowerShell real")
class WindowsPowerShellTests(unittest.TestCase):
    def test_real_powershell_runs_production_helper_against_simulated_desktop(self):
        source = "#pragma warning disable 0436\n" + monitor.WINDOWS_NOTIFY_SOURCE + FAKE_DESKTOP
        bootstrap = (
            "Microsoft.PowerShell.Utility\\Add-Type -TypeDefinition @'\n" + source + "\n'@\n"
            # O helper já foi compilado com as APIs de desktop simuladas.
            "function Add-Type { param($TypeDefinition, $ReferencedAssemblies) }\n"
        )
        for mode in ("closed", "clicked", "timeout", "error"):
            with self.subTest(mode=mode), tempfile.TemporaryDirectory() as directory:
                capture = Path(directory) / "trace.txt"
                with patch.dict(os.environ, {"MONITOR_TEST_CAPTURE": str(capture), "MONITOR_TEST_MODE": mode}), \
                     patch.object(monitor.sys, "platform", "win32"), \
                     patch.object(monitor.shutil, "which", return_value=PWSH):
                    real_run = subprocess.run

                    def portable_run(command, **options):
                        # macOS não suporta WindowStyle/STA. Preserva código e stdin de produção.
                        script = base64.b64decode(command[-1]).decode("utf-16-le")
                        encoded = base64.b64encode((bootstrap + script).encode("utf-16-le")).decode("ascii")
                        return real_run([PWSH, "-NoProfile", "-NonInteractive", "-EncodedCommand", encoded],
                                        cwd=directory, **options)

                    title = 'GitLab: "aspas" → 👍'
                    message = '$(Write-Output INDEVIDO); & | ` <b>\nacentos á 👍'
                    with patch.object(monitor.subprocess, "run", side_effect=portable_run), \
                         patch.object(monitor, "log") as log:
                        result = monitor.notify(title, message)
                        if mode == "error":
                            self.assertFalse(result)
                            self.assertIn("exit code 1", log.call_args.args[0])
                            self.assertIn("Simulated desktop unavailable", log.call_args.args[0])
                        else:
                            self.assertTrue(result, log.call_args_list)
                trace = capture.read_text(encoding="utf-8-sig").splitlines()
                if mode == "error":
                    self.assertIn("icon-disposed", trace)
                    self.assertIn("timer-disposed", trace)
                    continue
                values = dict(item.split(":", 1) for item in trace if ":" in item)
                self.assertEqual(base64.b64decode(values["title"]).decode("utf-8"), title)
                self.assertEqual(base64.b64decode(values["message"]).decode("utf-8"), message)
                self.assertEqual(values["safety-timeout"], "30000")
                self.assertLess(trace.index("loop-start"), trace.index("show:10000"))
                self.assertLess(trace.index("loop-end"), trace.index("icon-disposed"))
                self.assertEqual(trace.count("show:10000"), 1)
                self.assertEqual(trace.count("icon-disposed"), 1)


if __name__ == "__main__":
    unittest.main()
