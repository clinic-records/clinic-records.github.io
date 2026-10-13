using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Net;
using System.Net.Http;
using System.Runtime.InteropServices;
using System.Text;
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
            try
            {
                // Force TLS 1.2 and TLS 1.3 protocol support on Windows for GitHub API
                ServicePointManager.SecurityProtocol = (SecurityProtocolType)3072 | (SecurityProtocolType)12288 | SecurityProtocolType.Tls;
            }
            catch { }

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
        private bool hasOpenedBrowserThisRun = false;

        // Live stats
        private int onlineCount = 1;
        private int totalPatients = 0;
        private int todayPatients = 0;

        private NotifyIcon trayIcon;
        private ContextMenuStrip trayMenu;
        private Label lblStatusDot;
        private Label lblStatus;
        
        private Label lblOnlineCount;
        private Label lblTotalPatients;
        private Label lblTodayPatients;

        private TextBox txtUrl;
        private Button btnCopy;
        private Button btnOpen;
        private PictureBox pbQr;
        
        private Button btnToggleServer;
        private Button btnRestartServer;
        private Button btnQuickBackup;
        private Button btnOpenBackups;
        private Button btnCreateShortcut;
        private Button btnCheckUpdate;

        private System.Windows.Forms.Timer statsTimer;

        public DashboardForm()
        {
            appDir = AppDomain.CurrentDomain.BaseDirectory;
            InitializeComponent();
            StartServer();
            SetupDesktopShortcutSilently();

            // Periodic live stats polling every 4 seconds
            statsTimer = new System.Windows.Forms.Timer();
            statsTimer.Interval = 4000;
            statsTimer.Tick += async (s, e) => await PollServerStats();
            statsTimer.Start();
        }

        private void InitializeComponent()
        {
            this.Text = "سجلات العيادة الطبية - Clinic Records";
            this.Size = new Size(480, 650);
            this.FormBorderStyle = FormBorderStyle.FixedDialog;
            this.MaximizeBox = false;
            this.StartPosition = FormStartPosition.CenterScreen;
            this.BackColor = Color.FromArgb(248, 250, 252);
            this.Font = new Font("Segoe UI", 9.5f, FontStyle.Regular);

            // Extract embedded icon from executable itself
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
            lblHeader.Bounds = new Rectangle(20, 15, 425, 30);
            this.Controls.Add(lblHeader);

            // 2. Status Box (Dot + Text aligned)
            lblStatusDot = new Label();
            lblStatusDot.Text = "●";
            lblStatusDot.Font = new Font("Segoe UI", 14f, FontStyle.Bold);
            lblStatusDot.ForeColor = Color.FromArgb(16, 185, 129);
            lblStatusDot.TextAlign = ContentAlignment.MiddleRight;
            lblStatusDot.Bounds = new Rectangle(130, 48, 25, 26);
            this.Controls.Add(lblStatusDot);

            lblStatus = new Label();
            lblStatus.Text = "الخادم قيد الإقلاع...";
            lblStatus.Font = new Font("Segoe UI", 11f, FontStyle.Bold);
            lblStatus.ForeColor = Color.FromArgb(15, 23, 42);
            lblStatus.TextAlign = ContentAlignment.MiddleLeft;
            lblStatus.Bounds = new Rectangle(160, 48, 200, 26);
            this.Controls.Add(lblStatus);

            // 3. Live Stats Box (3 Columns Panel)
            GroupBox gbStats = new GroupBox();
            gbStats.Text = " حالة الاتصال والبيانات الحية ";
            gbStats.Bounds = new Rectangle(25, 80, 415, 55);
            gbStats.Font = new Font("Segoe UI", 8.5f, FontStyle.Bold);
            gbStats.ForeColor = Color.FromArgb(71, 85, 105);

            lblOnlineCount = new Label();
            lblOnlineCount.Text = "👥 المتصلون: 1";
            lblOnlineCount.ForeColor = Color.FromArgb(13, 148, 136);
            lblOnlineCount.Font = new Font("Segoe UI", 9f, FontStyle.Bold);
            lblOnlineCount.Bounds = new Rectangle(15, 22, 120, 22);
            gbStats.Controls.Add(lblOnlineCount);

            lblTotalPatients = new Label();
            lblTotalPatients.Text = "📋 إجمالي المرضى: 0";
            lblTotalPatients.ForeColor = Color.FromArgb(30, 41, 59);
            lblTotalPatients.Font = new Font("Segoe UI", 9f, FontStyle.Bold);
            lblTotalPatients.Bounds = new Rectangle(145, 22, 145, 22);
            gbStats.Controls.Add(lblTotalPatients);

            lblTodayPatients = new Label();
            lblTodayPatients.Text = "📅 اليوم: 0";
            lblTodayPatients.ForeColor = Color.FromArgb(30, 41, 59);
            lblTodayPatients.Font = new Font("Segoe UI", 9f, FontStyle.Bold);
            lblTodayPatients.Bounds = new Rectangle(300, 22, 105, 22);
            gbStats.Controls.Add(lblTodayPatients);

            this.Controls.Add(gbStats);

            // 4. Network URL Section
            Label lblUrlTitle = new Label();
            lblUrlTitle.Text = "رابط الشبكة المحلية (LAN URL):";
            lblUrlTitle.Font = new Font("Segoe UI", 9f, FontStyle.Bold);
            lblUrlTitle.ForeColor = Color.FromArgb(71, 85, 105);
            lblUrlTitle.Bounds = new Rectangle(30, 145, 380, 20);
            this.Controls.Add(lblUrlTitle);

            txtUrl = new TextBox();
            txtUrl.Text = "http://127.0.0.1:3000";
            txtUrl.ReadOnly = true;
            txtUrl.Font = new Font("Consolas", 10f, FontStyle.Regular);
            txtUrl.Bounds = new Rectangle(30, 168, 255, 28);
            this.Controls.Add(txtUrl);

            btnCopy = new Button();
            btnCopy.Text = "نسخ";
            btnCopy.Bounds = new Rectangle(295, 166, 65, 30);
            btnCopy.Click += (s, e) => {
                if (!string.IsNullOrEmpty(txtUrl.Text)) Clipboard.SetText(txtUrl.Text);
            };
            this.Controls.Add(btnCopy);

            btnOpen = new Button();
            btnOpen.Text = "فتح";
            btnOpen.Bounds = new Rectangle(365, 166, 65, 30);
            btnOpen.Click += (s, e) => {
                if (!string.IsNullOrEmpty(txtUrl.Text))
                {
                    try { Process.Start(new ProcessStartInfo(txtUrl.Text) { UseShellExecute = true }); } catch { }
                }
            };
            this.Controls.Add(btnOpen);

            // 5. QR Code Box
            GroupBox gbQr = new GroupBox();
            gbQr.Text = " رمز الدخول السريع (QR) ";
            gbQr.Bounds = new Rectangle(120, 208, 220, 200);
            gbQr.Font = new Font("Segoe UI", 9f, FontStyle.Bold);

            pbQr = new PictureBox();
            pbQr.Bounds = new Rectangle(20, 22, 180, 168);
            pbQr.SizeMode = PictureBoxSizeMode.Zoom;
            gbQr.Controls.Add(pbQr);
            this.Controls.Add(gbQr);

            Label lblQrHint = new Label();
            lblQrHint.Text = "امسح الرمز من الهاتف أو التابلت للفتح المباشر";
            lblQrHint.Font = new Font("Segoe UI", 8.5f, FontStyle.Regular);
            lblQrHint.ForeColor = Color.FromArgb(100, 116, 139);
            lblQrHint.TextAlign = ContentAlignment.MiddleCenter;
            lblQrHint.Bounds = new Rectangle(20, 412, 425, 20);
            this.Controls.Add(lblQrHint);

            // 6. Action Buttons Grid
            // Row 1: Start/Stop & Restart
            btnToggleServer = new Button();
            btnToggleServer.Text = "إيقاف السيرفر";
            btnToggleServer.Bounds = new Rectangle(30, 440, 195, 36);
            btnToggleServer.Font = new Font("Segoe UI", 9.5f, FontStyle.Bold);
            btnToggleServer.Click += (s, e) => ToggleServer();
            this.Controls.Add(btnToggleServer);

            btnRestartServer = new Button();
            btnRestartServer.Text = "🔄 إعادة تشغيل";
            btnRestartServer.Bounds = new Rectangle(235, 440, 195, 36);
            btnRestartServer.Font = new Font("Segoe UI", 9.5f, FontStyle.Bold);
            btnRestartServer.Click += async (s, e) => await RestartServer();
            this.Controls.Add(btnRestartServer);

            // Row 2: Quick Backup Now & Backups Folder
            btnQuickBackup = new Button();
            btnQuickBackup.Text = "💾 أخذ نسخة احتياطية الآن";
            btnQuickBackup.Bounds = new Rectangle(30, 484, 195, 36);
            btnQuickBackup.Font = new Font("Segoe UI", 9f, FontStyle.Regular);
            btnQuickBackup.Click += async (s, e) => await QuickBackupNow();
            this.Controls.Add(btnQuickBackup);

            btnOpenBackups = new Button();
            btnOpenBackups.Text = "📁 مجلد النسخ الاحتياطية";
            btnOpenBackups.Bounds = new Rectangle(235, 484, 195, 36);
            btnOpenBackups.Font = new Font("Segoe UI", 9f, FontStyle.Regular);
            btnOpenBackups.Click += (s, e) => OpenBackupsFolder();
            this.Controls.Add(btnOpenBackups);

            // Row 3: Desktop Shortcut & Update Check
            btnCreateShortcut = new Button();
            btnCreateShortcut.Text = "🖥️ اختصار سطح المكتب";
            btnCreateShortcut.Bounds = new Rectangle(30, 528, 195, 34);
            btnCreateShortcut.Font = new Font("Segoe UI", 9f, FontStyle.Regular);
            btnCreateShortcut.Click += (s, e) => CreateDesktopShortcut(true);
            this.Controls.Add(btnCreateShortcut);

            btnCheckUpdate = new Button();
            btnCheckUpdate.Text = "🔄 فحص التحديثات";
            btnCheckUpdate.Bounds = new Rectangle(235, 528, 195, 34);
            btnCheckUpdate.Font = new Font("Segoe UI", 9f, FontStyle.Regular);
            btnCheckUpdate.Click += async (s, e) => await CheckForUpdates();
            this.Controls.Add(btnCheckUpdate);

            // 7. Footer Hint
            Label lblFooter = new Label();
            lblFooter.Text = "ⓘ إغلاق هذه النافذة يُبقي السيرفر يعمل في شريط المهام بجوار الساعة";
            lblFooter.Font = new Font("Segoe UI", 8.5f, FontStyle.Italic);
            lblFooter.ForeColor = Color.FromArgb(148, 163, 184);
            lblFooter.TextAlign = ContentAlignment.MiddleCenter;
            lblFooter.Bounds = new Rectangle(20, 570, 425, 20);
            this.Controls.Add(lblFooter);

            // 8. System Tray Setup
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
            hasOpenedBrowserThisRun = false;
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

                // Pass LAUNCHED_BY_COMPANION=1 so node does NOT open duplicate browser tab
                psi.EnvironmentVariables["LAUNCHED_BY_COMPANION"] = "1";

                serverProcess = Process.Start(psi);
                isServerRunning = true;
                lblStatusDot.ForeColor = Color.FromArgb(16, 185, 129);
                lblStatus.Text = "الخادم يعمل بنجاح";
                btnToggleServer.Text = "إيقاف السيرفر";
                btnRestartServer.Enabled = true;
                btnQuickBackup.Enabled = true;

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
            btnRestartServer.Enabled = false;
            btnQuickBackup.Enabled = false;
        }

        private void ToggleServer()
        {
            if (isServerRunning) StopServer();
            else StartServer();
        }

        private async Task RestartServer()
        {
            StopServer();
            await Task.Delay(600);
            StartServer();
        }

        private async Task QuickBackupNow()
        {
            if (!isServerRunning)
            {
                MessageBox.Show("يجب تشغيل السيرفر أولاً لتتمكن من أخذ نسخة احتياطية.", "الخادم متوقف", MessageBoxButtons.OK, MessageBoxIcon.Warning);
                return;
            }

            try
            {
                btnQuickBackup.Enabled = false;
                btnQuickBackup.Text = "جارٍ النسخ...";

                using (var client = new HttpClient())
                {
                    client.Timeout = TimeSpan.FromSeconds(30);
                    var content = new StringContent("{}", Encoding.UTF8, "application/json");
                    var response = await client.PostAsync("http://127.0.0.1:" + currentPort + "/api/backup", content);
                    if (response.IsSuccessStatusCode)
                    {
                        MessageBox.Show("تم إنشاء نسخة احتياطية مؤمنة بنجاح وحفظها في مجلد النسخ الاحتياطية! 💾", "النسخ الاحتياطي", MessageBoxButtons.OK, MessageBoxIcon.Information);
                    }
                    else
                    {
                        MessageBox.Show("تعذر إنشاء النسخة الاحتياطية. رمز الخطأ: " + (int)response.StatusCode, "خطأ", MessageBoxButtons.OK, MessageBoxIcon.Warning);
                    }
                }
            }
            catch (Exception ex)
            {
                MessageBox.Show("تعذر الاتصال بالخادم لأخذ النسخة الاحتياطية:\n" + ex.Message, "خطأ", MessageBoxButtons.OK, MessageBoxIcon.Error);
            }
            finally
            {
                btnQuickBackup.Enabled = isServerRunning;
                btnQuickBackup.Text = "💾 أخذ نسخة احتياطية الآن";
            }
        }

        private void OpenBackupsFolder()
        {
            try
            {
                string backupsDir = Path.Combine(appDir, "backups");
                if (!Directory.Exists(backupsDir)) Directory.CreateDirectory(backupsDir);
                Process.Start("explorer.exe", backupsDir);
            }
            catch (Exception ex)
            {
                MessageBox.Show("تعذر فتح مجلد النسخ الاحتياطية: " + ex.Message, "تنبيه", MessageBoxButtons.OK, MessageBoxIcon.Warning);
            }
        }

        private void SetupDesktopShortcutSilently()
        {
            try
            {
                string desktopPath = Environment.GetFolderPath(Environment.SpecialFolder.Desktop);
                string shortcutPath = Path.Combine(desktopPath, "سجلات العيادة الطبية.lnk");
                if (!File.Exists(shortcutPath))
                {
                    CreateDesktopShortcut(false);
                }
            }
            catch { }
        }

        private void CreateDesktopShortcut(bool showPrompt)
        {
            try
            {
                string desktopPath = Environment.GetFolderPath(Environment.SpecialFolder.Desktop);
                string shortcutPath = Path.Combine(desktopPath, "سجلات العيادة الطبية.lnk");
                string exePath = Application.ExecutablePath;

                Type shellType = Type.GetTypeFromProgID("WScript.Shell");
                if (shellType != null)
                {
                    dynamic shell = Activator.CreateInstance(shellType);
                    var shortcut = shell.CreateShortcut(shortcutPath);
                    shortcut.TargetPath = exePath;
                    shortcut.WorkingDirectory = appDir;
                    shortcut.Description = "نظام إدارة سجلات العيادة الطبية";
                    shortcut.IconLocation = exePath + ",0";
                    shortcut.Save();

                    if (showPrompt)
                    {
                        MessageBox.Show("تم إنشاء اختصار البرنامج على سطح المكتب بنجاح!", "تم بنجاح", MessageBoxButtons.OK, MessageBoxIcon.Information);
                    }
                }
            }
            catch (Exception ex)
            {
                if (showPrompt)
                {
                    MessageBox.Show("تعذر إنشاء الاختصار: " + ex.Message, "خطأ", MessageBoxButtons.OK, MessageBoxIcon.Warning);
                }
            }
        }

        private async Task PollServerStats()
        {
            if (!isServerRunning) return;
            try
            {
                using (HttpClient client = new HttpClient())
                {
                    client.Timeout = TimeSpan.FromSeconds(2);
                    string json = await client.GetStringAsync("http://127.0.0.1:3000/api/network");
                    
                    var onlineMatch = Regex.Match(json, "\"onlineCount\"\\s*:\\s*(\\d+)");
                    var totalMatch = Regex.Match(json, "\"totalPatients\"\\s*:\\s*(\\d+)");
                    var todayMatch = Regex.Match(json, "\"todayPatients\"\\s*:\\s*(\\d+)");

                    if (onlineMatch.Success) int.TryParse(onlineMatch.Groups[1].Value, out onlineCount);
                    if (totalMatch.Success) int.TryParse(totalMatch.Groups[1].Value, out totalPatients);
                    if (todayMatch.Success) int.TryParse(todayMatch.Groups[1].Value, out todayPatients);

                    this.Invoke((MethodInvoker)delegate {
                        lblOnlineCount.Text = "👥 المتصلون: " + onlineCount;
                        lblTotalPatients.Text = "📋 إجمالي المرضى: " + totalPatients;
                        lblTodayPatients.Text = "📅 اليوم: " + todayPatients;
                    });
                }
            }
            catch { }
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
                        
                        var urlMatch = Regex.Match(json, "\"lanUrl\"\\s*:\\s*\"([^\"]+)\"");
                        var qrMatch = Regex.Match(json, "\"qrCodeDataUrl\"\\s*:\\s*\"data:image/[^;]+;base64,([^\"]+)\"");
                        var onlineMatch = Regex.Match(json, "\"onlineCount\"\\s*:\\s*(\\d+)");
                        var totalMatch = Regex.Match(json, "\"totalPatients\"\\s*:\\s*(\\d+)");
                        var todayMatch = Regex.Match(json, "\"todayPatients\"\\s*:\\s*(\\d+)");

                        if (urlMatch.Success)
                        {
                            lanUrl = urlMatch.Groups[1].Value;
                            if (onlineMatch.Success) int.TryParse(onlineMatch.Groups[1].Value, out onlineCount);
                            if (totalMatch.Success) int.TryParse(totalMatch.Groups[1].Value, out totalPatients);
                            if (todayMatch.Success) int.TryParse(todayMatch.Groups[1].Value, out todayPatients);

                            this.Invoke((MethodInvoker)delegate {
                                txtUrl.Text = lanUrl;
                                lblStatusDot.ForeColor = Color.FromArgb(16, 185, 129);
                                lblStatus.Text = "الخادم يعمل بنجاح";
                                lblOnlineCount.Text = "👥 المتصلون: " + onlineCount;
                                lblTotalPatients.Text = "📋 إجمالي المرضى: " + totalPatients;
                                lblTodayPatients.Text = "📅 اليوم: " + todayPatients;
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

                            // Open browser EXACTLY once on initial startup
                            if (!hasOpenedBrowserThisRun)
                            {
                                hasOpenedBrowserThisRun = true;
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
                try
                {
                    ServicePointManager.SecurityProtocol = (SecurityProtocolType)3072 | (SecurityProtocolType)12288 | SecurityProtocolType.Tls;
                }
                catch { }

                using (HttpClient client = new HttpClient())
                {
                    client.DefaultRequestHeaders.Add("User-Agent", "ClinicRecords-Windows-App");
                    client.DefaultRequestHeaders.Add("Accept", "application/vnd.github.v3+json");
                    string json = await client.GetStringAsync("https://api.github.com/repos/clinic-records/clinic-records.github.io/releases/latest");

                    var tagMatch = Regex.Match(json, "\"tag_name\"\\s*:\\s*\"([^\"]+)\"");
                    var htmlMatch = Regex.Match(json, "\"html_url\"\\s*:\\s*\"([^\"]+)\"");

                    string currentVersion = GetCurrentAppVersion();
                    if (tagMatch.Success)
                    {
                        string latest = tagMatch.Groups[1].Value;
                        if (string.Compare(latest, currentVersion, StringComparison.OrdinalIgnoreCase) > 0)
                        {
                            var res = MessageBox.Show(
                                "يوجد إصدار أحدث متوفر (" + latest + ")!\n\nهل ترغب في تثبيت التحديث وإعادة تشغيل البرنامج تلقائياً الآن؟\n(ملاحظة: سيتم أخذ نسخة احتياطية تأمينية للبيانات تلقائياً)",
                                "تحديث جديد متوفر",
                                MessageBoxButtons.YesNo,
                                MessageBoxIcon.Information
                            );
                            if (res == DialogResult.Yes)
                            {
                                btnCheckUpdate.Text = "جارٍ التحديث...";
                                try
                                {
                                    using (var localClient = new HttpClient())
                                    {
                                        var postRes = await localClient.PostAsync("http://127.0.0.1:" + currentPort + "/api/system/update/install", new StringContent(""));
                                        if (postRes.IsSuccessStatusCode)
                                        {
                                            MessageBox.Show("بدأت عملية التحديث بنجاح.\nسيتم تنزيل الحزمة وتحديث الملفات وإعادة تشغيل البرنامج تلقائياً خلال لحظات.", "تحديث المنظومة", MessageBoxButtons.OK, MessageBoxIcon.Information);
                                        }
                                        else
                                        {
                                            if (htmlMatch.Success) Process.Start(new ProcessStartInfo(htmlMatch.Groups[1].Value) { UseShellExecute = true });
                                        }
                                    }
                                }
                                catch
                                {
                                    if (htmlMatch.Success) Process.Start(new ProcessStartInfo(htmlMatch.Groups[1].Value) { UseShellExecute = true });
                                }
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

        private string GetCurrentAppVersion()
        {
            try
            {
                string[] candidates = new string[]
                {
                    Path.Combine(appDir, "resources", "package.json"),
                    Path.Combine(appDir, "package.json")
                };
                foreach (var p in candidates)
                {
                    if (File.Exists(p))
                    {
                        string txt = File.ReadAllText(p);
                        var m = Regex.Match(txt, "\"version\"\\s*:\\s*\"([^\"]+)\"");
                        if (m.Success)
                        {
                            string v = m.Groups[1].Value.Trim();
                            return v.StartsWith("v") ? v : "v" + v;
                        }
                    }
                }
            }
            catch { }
            return "v1.0.0";
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
            if (statsTimer != null)
            {
                statsTimer.Stop();
                statsTimer.Dispose();
            }
            if (trayIcon != null)
            {
                trayIcon.Visible = false;
                trayIcon.Dispose();
            }
            Environment.Exit(0);
        }
    }
}
