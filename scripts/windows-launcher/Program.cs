using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Net.Http;
using System.Runtime.InteropServices;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Forms;

namespace ClinicRecordsLauncher
{
    static class Program
    {
        private static EventWaitHandle showWindowHandle;

        [STAThread]
        static void Main()
        {
            bool createdNew;
            showWindowHandle = new EventWaitHandle(false, EventResetMode.AutoReset, "ClinicPatientRecordsShowWindowEvent", out createdNew);

            if (!createdNew)
            {
                // App is already running: wake existing companion dashboard ONLY, DO NOT reopen browser!
                try
                {
                    showWindowHandle.Set();
                }
                catch { }
                return;
            }

            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            DashboardForm mainForm = new DashboardForm();

            // Background listener for subsequent launcher invocations
            Task.Run(() =>
            {
                while (true)
                {
                    showWindowHandle.WaitOne();
                    try
                    {
                        if (mainForm != null && !mainForm.IsDisposed)
                        {
                            mainForm.Invoke((MethodInvoker)delegate {
                                mainForm.ShowDashboard();
                            });
                        }
                    }
                    catch { }
                }
            });

            Application.Run(mainForm);
        }
    }

    public class DashboardForm : Form
    {
        [DllImport("user32.dll")]
        private static extern bool SetForegroundWindow(IntPtr hWnd);

        private Process serverProcess;
        private string appDir;
        private string lanUrl = "http://127.0.0.1:3000";
        private int currentPort = 3000;
        private bool isServerRunning = false;

        private NotifyIcon trayIcon;
        private ContextMenuStrip trayMenu;
        private Label lblStatusDot;
        private Label lblStatus;
        private TextBox txtUrl;
        private Button btnCopy;
        private Button btnOpen;
        private PictureBox pbQr;
        private Button btnToggleServer;
        private Button btnCheckUpdate;

        public DashboardForm()
        {
            appDir = AppDomain.CurrentDomain.BaseDirectory;
            InitializeComponent();
            StartServer();
        }

        private void InitializeComponent()
        {
            this.Text = "سجلات العيادة الطبية - Clinic Records";
            this.Size = new Size(460, 560);
            this.FormBorderStyle = FormBorderStyle.FixedDialog;
            this.MaximizeBox = false;
            this.StartPosition = FormStartPosition.CenterScreen;
            this.BackColor = Color.FromArgb(248, 250, 252);
            this.Font = new Font("Segoe UI", 9.5f, FontStyle.Regular);

            // Extract embedded icon from executable itself (no loose .ico needed)
            try
            {
                this.Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath);
            }
            catch
            {
                string icoPath = Path.Combine(appDir, "resources", "AppIcon.ico");
                if (File.Exists(icoPath))
                {
                    try { this.Icon = new Icon(icoPath); } catch { }
                }
            }

            // 1. Header Label
            Label lblHeader = new Label();
            lblHeader.Text = "لوحة تحكم خادم العيادة";
            lblHeader.Font = new Font("Segoe UI", 14f, FontStyle.Bold);
            lblHeader.ForeColor = Color.FromArgb(15, 23, 42);
            lblHeader.TextAlign = ContentAlignment.MiddleCenter;
            lblHeader.Bounds = new Rectangle(20, 15, 400, 30);
            this.Controls.Add(lblHeader);

            // 2. Status Box (Dot + Text aligned)
            lblStatusDot = new Label();
            lblStatusDot.Text = "●";
            lblStatusDot.Font = new Font("Segoe UI", 14f, FontStyle.Bold);
            lblStatusDot.ForeColor = Color.FromArgb(16, 185, 129);
            lblStatusDot.TextAlign = ContentAlignment.MiddleRight;
            lblStatusDot.Bounds = new Rectangle(120, 48, 25, 26);
            this.Controls.Add(lblStatusDot);

            lblStatus = new Label();
            lblStatus.Text = "الخادم قيد الإقلاع...";
            lblStatus.Font = new Font("Segoe UI", 11f, FontStyle.Bold);
            lblStatus.ForeColor = Color.FromArgb(15, 23, 42);
            lblStatus.TextAlign = ContentAlignment.MiddleLeft;
            lblStatus.Bounds = new Rectangle(150, 48, 200, 26);
            this.Controls.Add(lblStatus);

            // 3. Network URL Section
            Label lblUrlTitle = new Label();
            lblUrlTitle.Text = "رابط الشبكة المحلية (LAN URL):";
            lblUrlTitle.Font = new Font("Segoe UI", 9f, FontStyle.Bold);
            lblUrlTitle.ForeColor = Color.FromArgb(71, 85, 105);
            lblUrlTitle.Bounds = new Rectangle(30, 85, 380, 20);
            this.Controls.Add(lblUrlTitle);

            txtUrl = new TextBox();
            txtUrl.Text = "http://127.0.0.1:3000";
            txtUrl.ReadOnly = true;
            txtUrl.Font = new Font("Consolas", 10f, FontStyle.Regular);
            txtUrl.Bounds = new Rectangle(30, 110, 240, 28);
            this.Controls.Add(txtUrl);

            btnCopy = new Button();
            btnCopy.Text = "نسخ";
            btnCopy.Bounds = new Rectangle(280, 108, 65, 30);
            btnCopy.Click += (s, e) => {
                if (!string.IsNullOrEmpty(txtUrl.Text)) Clipboard.SetText(txtUrl.Text);
            };
            this.Controls.Add(btnCopy);

            btnOpen = new Button();
            btnOpen.Text = "فتح";
            btnOpen.Bounds = new Rectangle(350, 108, 65, 30);
            btnOpen.Click += (s, e) => {
                if (!string.IsNullOrEmpty(txtUrl.Text))
                {
                    try { Process.Start(new ProcessStartInfo(txtUrl.Text) { UseShellExecute = true }); } catch { }
                }
            };
            this.Controls.Add(btnOpen);

            // 4. QR Code Box
            GroupBox gbQr = new GroupBox();
            gbQr.Text = " رمز الدخول السريع (QR) ";
            gbQr.Bounds = new Rectangle(110, 155, 220, 220);
            gbQr.Font = new Font("Segoe UI", 9f, FontStyle.Bold);

            pbQr = new PictureBox();
            pbQr.Bounds = new Rectangle(20, 25, 180, 180);
            pbQr.SizeMode = PictureBoxSizeMode.Zoom;
            gbQr.Controls.Add(pbQr);
            this.Controls.Add(gbQr);

            Label lblQrHint = new Label();
            lblQrHint.Text = "امسح الرمز من الهاتف أو التابلت للفتح المباشر";
            lblQrHint.Font = new Font("Segoe UI", 8.5f, FontStyle.Regular);
            lblQrHint.ForeColor = Color.FromArgb(100, 116, 139);
            lblQrHint.TextAlign = ContentAlignment.MiddleCenter;
            lblQrHint.Bounds = new Rectangle(20, 380, 400, 20);
            this.Controls.Add(lblQrHint);

            // 5. Action Buttons
            btnToggleServer = new Button();
            btnToggleServer.Text = "إيقاف السيرفر";
            btnToggleServer.Bounds = new Rectangle(40, 410, 170, 38);
            btnToggleServer.Font = new Font("Segoe UI", 9.5f, FontStyle.Bold);
            btnToggleServer.Click += (s, e) => ToggleServer();
            this.Controls.Add(btnToggleServer);

            btnCheckUpdate = new Button();
            btnCheckUpdate.Text = "فحص التحديثات";
            btnCheckUpdate.Bounds = new Rectangle(230, 410, 170, 38);
            btnCheckUpdate.Font = new Font("Segoe UI", 9.5f, FontStyle.Bold);
            btnCheckUpdate.Click += async (s, e) => await CheckForUpdates();
            this.Controls.Add(btnCheckUpdate);

            // 6. Footer Hint
            Label lblFooter = new Label();
            lblFooter.Text = "ⓘ إغلاق هذه النافذة يُبقي السيرفر يعمل في شريط المهام بجوار الساعة";
            lblFooter.Font = new Font("Segoe UI", 8.5f, FontStyle.Italic);
            lblFooter.ForeColor = Color.FromArgb(148, 163, 184);
            lblFooter.TextAlign = ContentAlignment.MiddleCenter;
            lblFooter.Bounds = new Rectangle(20, 470, 400, 20);
            this.Controls.Add(lblFooter);

            // 7. System Tray Setup
            trayMenu = new ContextMenuStrip();
            trayMenu.Items.Add("لوحة التحكم (Dashboard)", null, (s, e) => ShowDashboard());
            trayMenu.Items.Add("فتح في المتصفح", null, (s, e) => {
                try { Process.Start(new ProcessStartInfo(lanUrl) { UseShellExecute = true }); } catch { }
            });
            trayMenu.Items.Add(new ToolStripSeparator());
            trayMenu.Items.Add("إنهاء البرنامج بالكامل (خروج)", null, (s, e) => ExitApp());

            trayIcon = new NotifyIcon();
            trayIcon.Text = "Clinic Patient Records";
            if (this.Icon != null) trayIcon.Icon = this.Icon;
            trayIcon.ContextMenuStrip = trayMenu;
            trayIcon.Visible = true;
            trayIcon.DoubleClick += (s, e) => ShowDashboard();

            this.FormClosing += DashboardForm_FormClosing;
        }

        private void StartServer()
        {
            string nodePath = Path.Combine(appDir, "resources", "runtime", "node.exe");
            if (!File.Exists(nodePath)) nodePath = Path.Combine(appDir, "runtime", "node.exe");
            if (!File.Exists(nodePath)) nodePath = "node";

            string scriptPath = Path.Combine(appDir, "resources", "dist", "server.js");
            if (!File.Exists(scriptPath)) scriptPath = Path.Combine(appDir, "dist", "server.js");

            try
            {
                ProcessStartInfo psi = new ProcessStartInfo();
                psi.FileName = nodePath;
                psi.Arguments = "\"" + scriptPath + "\"";
                psi.WorkingDirectory = appDir;
                psi.UseShellExecute = false;
                psi.CreateNoWindow = true;

                serverProcess = Process.Start(psi);
                isServerRunning = true;
                lblStatusDot.ForeColor = Color.FromArgb(16, 185, 129);
                lblStatus.Text = "الخادم يعمل بنجاح";
                btnToggleServer.Text = "إيقاف السيرفر";

                Task.Run(async () => await PollServerNetwork());
            }
            catch (Exception ex)
            {
                lblStatusDot.ForeColor = Color.FromArgb(239, 68, 68);
                lblStatus.Text = "فشل تشغيل الخادم";
                MessageBox.Show("تعذر تشغيل خادم العيادة: " + ex.Message, "خطأ", MessageBoxButtons.OK, MessageBoxIcon.Error);
            }
        }

        private void StopServer()
        {
            if (serverProcess != null && !serverProcess.HasExited)
            {
                try
                {
                    serverProcess.Kill();
                    serverProcess.WaitForExit(1000);
                }
                catch { }
            }
            serverProcess = null;
            isServerRunning = false;
            lblStatusDot.ForeColor = Color.FromArgb(239, 68, 68);
            lblStatus.Text = "الخادم متوقف حالياً";
            btnToggleServer.Text = "تشغيل السيرفر";
        }

        private void ToggleServer()
        {
            if (isServerRunning) StopServer();
            else StartServer();
        }

        private async Task PollServerNetwork()
        {
            using (HttpClient client = new HttpClient())
            {
                client.Timeout = TimeSpan.FromSeconds(2);
                for (int i = 0; i < 30; i++)
                {
                    if (!isServerRunning) return;
                    await Task.Delay(600);

                    try
                    {
                        string json = await client.GetStringAsync("http://127.0.0.1:3000/api/network");
                        
                        // Parse JSON fields
                        var urlMatch = Regex.Match(json, "\"lanUrl\"\\s*:\\s*\"([^\"]+)\"");
                        var qrMatch = Regex.Match(json, "\"qrCodeDataUrl\"\\s*:\\s*\"data:image/[^;]+;base64,([^\"]+)\"");

                        if (urlMatch.Success)
                        {
                            lanUrl = urlMatch.Groups[1].Value;
                            this.Invoke((MethodInvoker)delegate {
                                txtUrl.Text = lanUrl;
                                lblStatusDot.ForeColor = Color.FromArgb(16, 185, 129);
                                lblStatus.Text = "الخادم يعمل بنجاح";
                            });

                            if (qrMatch.Success)
                            {
                                byte[] imgBytes = Convert.FromBase64String(qrMatch.Groups[1].Value);
                                using (MemoryStream ms = new MemoryStream(imgBytes))
                                {
                                    Image img = Image.FromStream(ms);
                                    this.Invoke((MethodInvoker)delegate {
                                        pbQr.Image = new Bitmap(img);
                                    });
                                }
                            }

                            // Open browser automatically on server startup
                            if (i == 0 || !string.IsNullOrEmpty(lanUrl))
                            {
                                try { Process.Start(new ProcessStartInfo(lanUrl) { UseShellExecute = true }); } catch { }
                            }
                            return;
                        }
                    }
                    catch { }
                }
            }
        }

        private async Task CheckForUpdates()
        {
            btnCheckUpdate.Enabled = false;
            btnCheckUpdate.Text = "جارٍ الفحص...";

            try
            {
                using (HttpClient client = new HttpClient())
                {
                    client.DefaultRequestHeaders.Add("User-Agent", "ClinicRecords-Windows");
                    client.DefaultRequestHeaders.Add("Accept", "application/vnd.github.v3+json");
                    string json = await client.GetStringAsync("https://api.github.com/repos/clinic-records/clinic-records.github.io/releases/latest");

                    var tagMatch = Regex.Match(json, "\"tag_name\"\\s*:\\s*\"([^\"]+)\"");
                    var htmlMatch = Regex.Match(json, "\"html_url\"\\s*:\\s*\"([^\"]+)\"");

                    string currentVersion = "v1.0.3";
                    if (tagMatch.Success)
                    {
                        string latest = tagMatch.Groups[1].Value;
                        if (string.Compare(latest, currentVersion, StringComparison.OrdinalIgnoreCase) > 0)
                        {
                            var res = MessageBox.Show(
                                "يوجد إصدار أحدث متاح (" + latest + ")!\nهل ترغب في فتح صفحة التحميل للحصول على النسخة الجديدة؟",
                                "تحديث جديد متاح",
                                MessageBoxButtons.YesNo,
                                MessageBoxIcon.Information
                            );
                            if (res == DialogResult.Yes && htmlMatch.Success)
                            {
                                Process.Start(new ProcessStartInfo(htmlMatch.Groups[1].Value) { UseShellExecute = true });
                            }
                        }
                        else
                        {
                            MessageBox.Show("أنت تستخدم أحدث إصدار بالفعل (" + currentVersion + ").", "البرنامج محدث", MessageBoxButtons.OK, MessageBoxIcon.Information);
                        }
                    }
                }
            }
            catch (Exception ex)
            {
                MessageBox.Show("تعذر فحص التحديثات: " + ex.Message, "تنبيه", MessageBoxButtons.OK, MessageBoxIcon.Warning);
            }
            finally
            {
                btnCheckUpdate.Enabled = true;
                btnCheckUpdate.Text = "فحص التحديثات";
            }
        }

        public void ShowDashboard()
        {
            this.Show();
            if (this.WindowState == FormWindowState.Minimized)
            {
                this.WindowState = FormWindowState.Normal;
            }
            this.BringToFront();
            this.Activate();
            try { SetForegroundWindow(this.Handle); } catch { }
        }

        private void DashboardForm_FormClosing(object sender, FormClosingEventArgs e)
        {
            if (e.CloseReason == CloseReason.UserClosing)
            {
                e.Cancel = true;
                this.Hide();
            }
        }

        private void ExitApp()
        {
            StopServer();
            if (trayIcon != null)
            {
                trayIcon.Visible = false;
                trayIcon.Dispose();
            }
            Environment.Exit(0);
        }
    }
}
