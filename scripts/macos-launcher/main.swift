import Cocoa
import Foundation

class ServerManager {
    static let shared = ServerManager()
    
    var process: Process?
    var isRunning = false
    var lanUrl: String = ""
    var currentPort: Int = 3000
    var qrImage: NSImage?
    var onStatusChanged: (() -> Void)?
    
    func startServer() {
        guard process == nil else { return }
        
        let bundleUrl = Bundle.main.bundleURL
        let appDir = bundleUrl.appendingPathComponent("Contents/Resources/app").path
        let nodePath = "\(appDir)/runtime/bin/node"
        let scriptPath = "\(appDir)/dist/server.js"
        
        let containerDir = bundleUrl.deletingLastPathComponent().path
        let isAppFolder = containerDir == "/Applications" || !FileManager.default.isWritableFile(atPath: containerDir)
        
        let workingDir: String
        if isAppFolder {
            let appSupport = FileManager.default.homeDirectoryForCurrentUser
                .appendingPathComponent("Library/Application Support/ClinicRecords").path
            try? FileManager.default.createDirectory(atPath: appSupport, withIntermediateDirectories: true)
            workingDir = appSupport
        } else {
            workingDir = containerDir
        }
        
        // Ensure storage directories exist
        try? FileManager.default.createDirectory(atPath: "\(workingDir)/data", withIntermediateDirectories: true)
        try? FileManager.default.createDirectory(atPath: "\(workingDir)/backups", withIntermediateDirectories: true)
        try? FileManager.default.createDirectory(atPath: "\(workingDir)/storage/patients", withIntermediateDirectories: true)
        
        let proc = Process()
        proc.executableURL = URL(fileURLWithPath: FileManager.default.fileExists(atPath: nodePath) ? nodePath : "/usr/local/bin/node")
        proc.arguments = [scriptPath]
        proc.currentDirectoryURL = URL(fileURLWithPath: workingDir)
        
        var env = ProcessInfo.processInfo.environment
        env["NODE_ENV"] = "production"
        proc.environment = env
        
        proc.terminationHandler = { [weak self] _ in
            DispatchQueue.main.async {
                self?.process = nil
                self?.isRunning = false
                self?.onStatusChanged?()
            }
        }
        
        do {
            try proc.run()
            self.process = proc
            self.isRunning = true
            self.onStatusChanged?()
            self.pollForServerReady()
        } catch {
            print("Failed to start server: \(error)")
        }
    }
    
    func stopServer() {
        guard let proc = process else { return }
        proc.terminate()
        process = nil
        isRunning = false
        onStatusChanged?()
    }
    
    func toggleServer() {
        if isRunning {
            stopServer()
        } else {
            startServer()
        }
    }
    
    private func pollForServerReady(attempt: Int = 0) {
        guard attempt < 30, isRunning else { return }
        
        let url = URL(string: "http://127.0.0.1:3000/api/network")!
        let task = URLSession.shared.dataTask(with: url) { [weak self] data, response, error in
            if let data = data,
               let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
               let lan = json["lanUrl"] as? String,
               let port = json["port"] as? Int {
                
                var qr: NSImage? = nil
                if let qrDataUrl = json["qrCodeDataUrl"] as? String,
                   let base64 = qrDataUrl.components(separatedBy: ",").last,
                   let imgData = Data(base64Encoded: base64) {
                    qr = NSImage(data: imgData)
                }
                
                DispatchQueue.main.async {
                    self?.lanUrl = lan
                    self?.currentPort = port
                    self?.qrImage = qr
                    self?.onStatusChanged?()
                    
                    if attempt == 0 || self?.lanUrl != "" {
                        if let browserUrl = URL(string: lan) {
                            NSWorkspace.shared.open(browserUrl)
                        }
                    }
                }
            } else {
                DispatchQueue.global().asyncAfter(deadline: .now() + 0.5) {
                    self?.pollForServerReady(attempt: attempt + 1)
                }
            }
        }
        task.resume()
    }
}

class DashboardWindowController: NSWindowController, NSWindowDelegate {
    private var statusDot: NSTextField!
    private var statusLabel: NSTextField!
    private var urlField: NSTextField!
    private var copyButton: NSButton!
    private var openBrowserButton: NSButton!
    private var qrImageView: NSImageView!
    private var toggleButton: NSButton!
    private var updateButton: NSButton!
    
    convenience init() {
        let window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 440, height: 530),
            styleMask: [.titled, .closable, .miniaturizable],
            backing: .buffered,
            defer: false
        )
        window.center()
        window.title = "سجلات العيادة الطبية - Clinic Records"
        window.isReleasedWhenClosed = false
        
        self.init(window: window)
        window.delegate = self
        setupUI()
        
        ServerManager.shared.onStatusChanged = { [weak self] in
            self?.updateUI()
        }
    }
    
    private func setupUI() {
        guard let contentView = window?.contentView else { return }
        
        // 1. Header Title
        let titleLabel = NSTextField(labelWithString: "لوحة تحكم خادم العيادة")
        titleLabel.font = NSFont.boldSystemFont(ofSize: 18)
        titleLabel.alignment = .center
        titleLabel.frame = NSRect(x: 20, y: 480, width: 400, height: 26)
        contentView.addSubview(titleLabel)
        
        // 2. Status Box
        statusDot = NSTextField(labelWithString: "●")
        statusDot.font = NSFont.systemFont(ofSize: 18)
        statusDot.textColor = .systemGreen
        statusDot.frame = NSRect(x: 145, y: 442, width: 20, height: 22)
        contentView.addSubview(statusDot)
        
        statusLabel = NSTextField(labelWithString: "الخادم قيد الإقلاع...")
        statusLabel.font = NSFont.boldSystemFont(ofSize: 14)
        statusLabel.frame = NSRect(x: 170, y: 443, width: 160, height: 22)
        contentView.addSubview(statusLabel)
        
        // 3. Network URL Section
        let urlTitle = NSTextField(labelWithString: "رابط الشبكة المحلية (LAN URL):")
        urlTitle.font = NSFont.boldSystemFont(ofSize: 12)
        urlTitle.frame = NSRect(x: 30, y: 405, width: 380, height: 18)
        contentView.addSubview(urlTitle)
        
        urlField = NSTextField(string: "http://127.0.0.1:3000")
        urlField.isEditable = false
        urlField.font = NSFont.monospacedSystemFont(ofSize: 13, weight: .medium)
        urlField.frame = NSRect(x: 30, y: 375, width: 240, height: 26)
        contentView.addSubview(urlField)
        
        copyButton = NSButton(title: "نسخ", target: self, action: #selector(copyUrlClicked))
        copyButton.bezelStyle = .rounded
        copyButton.frame = NSRect(x: 275, y: 371, width: 65, height: 32)
        contentView.addSubview(copyButton)
        
        openBrowserButton = NSButton(title: "فتح", target: self, action: #selector(openBrowserClicked))
        openBrowserButton.bezelStyle = .rounded
        openBrowserButton.frame = NSRect(x: 345, y: 371, width: 65, height: 32)
        contentView.addSubview(openBrowserButton)
        
        // 4. QR Code Box
        let qrBox = NSBox(frame: NSRect(x: 100, y: 155, width: 240, height: 215))
        qrBox.title = "رمز الدخول السريع (QR)"
        qrBox.titlePosition = .atTop
        
        qrImageView = NSImageView()
        qrImageView.imageScaling = .scaleProportionallyUpOrDown
        qrImageView.translatesAutoresizingMaskIntoConstraints = false
        if let container = qrBox.contentView {
            container.addSubview(qrImageView)
            NSLayoutConstraint.activate([
                qrImageView.centerXAnchor.constraint(equalTo: container.centerXAnchor),
                qrImageView.centerYAnchor.constraint(equalTo: container.centerYAnchor, constant: -6),
                qrImageView.widthAnchor.constraint(equalToConstant: 160),
                qrImageView.heightAnchor.constraint(equalToConstant: 160)
            ])
        }
        contentView.addSubview(qrBox)
        
        let qrHint = NSTextField(labelWithString: "امسح الرمز من الهاتف أو التابلت للفتح المباشر")
        qrHint.font = NSFont.systemFont(ofSize: 11)
        qrHint.textColor = .secondaryLabelColor
        qrHint.alignment = .center
        qrHint.frame = NSRect(x: 20, y: 125, width: 400, height: 18)
        contentView.addSubview(qrHint)
        
        // 5. Action Buttons
        toggleButton = NSButton(title: "إيقاف السيرفر", target: self, action: #selector(toggleServerClicked))
        toggleButton.bezelStyle = .rounded
        toggleButton.frame = NSRect(x: 40, y: 70, width: 170, height: 38)
        contentView.addSubview(toggleButton)
        
        updateButton = NSButton(title: "فحص التحديثات", target: self, action: #selector(checkUpdatesClicked))
        updateButton.bezelStyle = .rounded
        updateButton.frame = NSRect(x: 230, y: 70, width: 170, height: 38)
        contentView.addSubview(updateButton)
        
        // 6. Footer Hint
        let footerHint = NSTextField(labelWithString: "ⓘ إغلاق هذه النافذة يُبقي السيرفر يعمل في شريط القوائم العلوي")
        footerHint.font = NSFont.systemFont(ofSize: 11)
        footerHint.textColor = .tertiaryLabelColor
        footerHint.alignment = .center
        footerHint.frame = NSRect(x: 20, y: 25, width: 400, height: 18)
        contentView.addSubview(footerHint)
        
        updateUI()
    }
    
    func updateUI() {
        let isRunning = ServerManager.shared.isRunning
        statusDot.textColor = isRunning ? .systemGreen : .systemRed
        statusLabel.stringValue = isRunning ? "الخادم يعمل بنجاح" : "الخادم متوقف حالياً"
        toggleButton.title = isRunning ? "إيقاف السيرفر" : "تشغيل السيرفر"
        
        if !ServerManager.shared.lanUrl.isEmpty {
            urlField.stringValue = ServerManager.shared.lanUrl
        }
        
        if let qr = ServerManager.shared.qrImage {
            qrImageView.image = qr
        }
    }
    
    @objc private func copyUrlClicked() {
        let pb = NSPasteboard.general
        pb.clearContents()
        pb.setString(urlField.stringValue, forType: .string)
    }
    
    @objc private func openBrowserClicked() {
        if let url = URL(string: urlField.stringValue) {
            NSWorkspace.shared.open(url)
        }
    }
    
    @objc private func toggleServerClicked() {
        ServerManager.shared.toggleServer()
    }
    
    @objc private func checkUpdatesClicked() {
        updateButton.isEnabled = false
        updateButton.title = "جارٍ الفحص..."
        
        let url = URL(string: "https://api.github.com/repos/clinic-records/clinic-records.github.io/releases/latest")!
        var req = URLRequest(url: url)
        req.setValue("application/vnd.github.v3+json", forHTTPHeaderField: "Accept")
        req.setValue("ClinicRecords-App", forHTTPHeaderField: "User-Agent")
        
        URLSession.shared.dataTask(with: req) { [weak self] data, response, error in
            DispatchQueue.main.async {
                self?.updateButton.isEnabled = true
                self?.updateButton.title = "فحص التحديثات"
                
                guard let data = data,
                      let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                      let latestTag = json["tag_name"] as? String else {
                    let alert = NSAlert()
                    alert.messageText = "تعذر التحقق من التحديثات"
                    alert.informativeText = "تأكد من اتصالك بالإنترنت وحاول مرة أخرى."
                    alert.runModal()
                    return
                }
                
                let currentVer = "v1.0.3"
                if latestTag.compare(currentVer, options: .numeric) == .orderedDescending {
                    let alert = NSAlert()
                    alert.messageText = "يوجد تحديث جديد متاحة (\(latestTag))!"
                    alert.informativeText = "هل ترغب في فتح صفحة التحميل للحصول على آخر نسخة؟"
                    alert.addButton(withTitle: "فتح صفحة التحميل")
                    alert.addButton(withTitle: "إلغاء")
                    if alert.runModal() == .alertFirstButtonReturn {
                        if let htmlUrl = json["html_url"] as? String, let u = URL(string: htmlUrl) {
                            NSWorkspace.shared.open(u)
                        }
                    }
                } else {
                    let alert = NSAlert()
                    alert.messageText = "أنت تستخدم أحدث إصدار!"
                    alert.informativeText = "البرنامج محدث بالكامل (\(currentVer))."
                    alert.runModal()
                }
            }
        }.resume()
    }
    
    func windowShouldClose(_ sender: NSWindow) -> Bool {
        sender.orderOut(nil)
        return false
    }
}

class AppDelegate: NSObject, NSApplicationDelegate {
    var dashboardController: DashboardWindowController?
    var statusItem: NSStatusItem?
    
    func applicationDidFinishLaunching(_ notification: Notification) {
        // Single Instance Check
        let bundleId = Bundle.main.bundleIdentifier ?? "io.github.clinicrecords.app"
        let currentPid = ProcessInfo.processInfo.processIdentifier
        let runningApps = NSRunningApplication.runningApplications(withBundleIdentifier: bundleId)
        
        for app in runningApps where app.processIdentifier != currentPid {
            // Signal running instance to bring its window to front
            DistributedNotificationCenter.default().postNotificationName(
                NSNotification.Name("io.github.clinicrecords.showDashboard"),
                object: nil,
                userInfo: nil,
                deliverImmediately: true
            )
            app.activate()
            // Do NOT open browser! Exit immediately
            exit(0)
        }
        
        // Listen for requests to show dashboard from subsequent launches
        DistributedNotificationCenter.default().addObserver(
            self,
            selector: #selector(showDashboard),
            name: NSNotification.Name("io.github.clinicrecords.showDashboard"),
            object: nil
        )
        
        dashboardController = DashboardWindowController()
        dashboardController?.showWindow(nil)
        NSApp.activate(ignoringOtherApps: true)
        
        setupStatusItem()
        ServerManager.shared.startServer()
    }
    
    private func setupStatusItem() {
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        statusItem?.button?.title = "🏥 Clinic"
        
        let menu = NSMenu()
        menu.addItem(NSMenuItem(title: "لوحة التحكم (Dashboard)", action: #selector(showDashboard), keyEquivalent: "d"))
        menu.addItem(NSMenuItem(title: "فتح في المتصفح", action: #selector(openBrowser), keyEquivalent: "b"))
        menu.addItem(NSMenuItem(title: "إيقاف / تشغيل السيرفر", action: #selector(toggleServer), keyEquivalent: "s"))
        menu.addItem(NSMenuItem.separator())
        menu.addItem(NSMenuItem(title: "إنهاء البرنامج بالكامل (Quit)", action: #selector(quitApp), keyEquivalent: "q"))
        
        statusItem?.menu = menu
    }
    
    @objc func showDashboard() {
        dashboardController?.window?.deminiaturize(nil)
        dashboardController?.showWindow(nil)
        dashboardController?.window?.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }
    
    @objc func openBrowser() {
        let urlStr = ServerManager.shared.lanUrl.isEmpty ? "http://127.0.0.1:3000" : ServerManager.shared.lanUrl
        if let url = URL(string: urlStr) {
            NSWorkspace.shared.open(url)
        }
    }
    
    @objc func toggleServer() {
        ServerManager.shared.toggleServer()
    }
    
    @objc func quitApp() {
        ServerManager.shared.stopServer()
        NSApp.terminate(nil)
    }
    
    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        showDashboard()
        return true
    }
    
    func applicationWillTerminate(_ notification: Notification) {
        ServerManager.shared.stopServer()
    }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.regular)
app.run()
