import Cocoa
import Foundation

class SSEStreamDelegate: NSObject, URLSessionDataDelegate {
    var onLine: ((String) -> Void)?
    private var buffer = ""
    
    init(onLine: @escaping (String) -> Void) {
        self.onLine = onLine
    }
    
    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
        guard let text = String(data: data, encoding: .utf8) else { return }
        buffer += text
        while let range = buffer.range(of: "\n") {
            let line = String(buffer[..<range.lowerBound]).trimmingCharacters(in: .whitespacesAndNewlines)
            buffer.removeSubrange(...range.lowerBound)
            if !line.isEmpty {
                onLine?(line)
            }
        }
    }
}

class ServerManager {
    static let shared = ServerManager()
    
    var process: Process?
    var isRunning = false
    var lanUrl: String = ""
    var mdnsUrl: String = ""
    var currentPort: Int = 3000
    var qrImage: NSImage?
    var workingDir: String = ""
    var hasOpenedBrowserThisRun = false
    private var netService: NetService?
    
    // Live Server Stats
    var onlineCount: Int = 0
    var totalPatients: Int = 0
    var todayPatients: Int = 0
    var latestBackupTime: String = ""
    
    var onStatusChanged: (() -> Void)?
    private var pollTimer: Timer?
    private var sseSession: URLSession?
    private var sseTask: URLSessionDataTask?
    
    func startServer() {
        guard process == nil else { return }
        hasOpenedBrowserThisRun = false
        
        let bundleUrl = Bundle.main.bundleURL
        let appDir = bundleUrl.appendingPathComponent("Contents/Resources/app").path
        let nodePath = "\(appDir)/runtime/bin/node"
        let scriptPath = "\(appDir)/dist/server.js"
        
        let containerDir = bundleUrl.deletingLastPathComponent().path
        let isAppFolder = containerDir == "/Applications" || !FileManager.default.isWritableFile(atPath: containerDir)
        
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
        env["LAUNCHED_BY_COMPANION"] = "1"
        proc.environment = env
        
        proc.terminationHandler = { [weak self] _ in
            DispatchQueue.main.async {
                self?.process = nil
                self?.isRunning = false
                self?.stopPeriodicPolling()
                self?.onStatusChanged?()
            }
        }
        
        do {
            try proc.run()
            self.process = proc
            self.isRunning = true
            self.onStatusChanged?()
            self.pollForServerReady()
            self.startPeriodicPolling()
        } catch {
            print("Failed to start server: \(error)")
        }
    }
    
    func stopServer() {
        stopPeriodicPolling()
        stopRealtimeListener()
        netService?.stop()
        netService = nil
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
    
    private func startPeriodicPolling() {
        stopPeriodicPolling()
        DispatchQueue.main.async { [weak self] in
            self?.pollTimer = Timer.scheduledTimer(withTimeInterval: 4.0, repeats: true) { [weak self] _ in
                self?.fetchServerStats()
            }
        }
    }
    
    private func stopPeriodicPolling() {
        pollTimer?.invalidate()
        pollTimer = nil
    }
    
    private func startRealtimeListener() {
        stopRealtimeListener()
        guard isRunning else { return }
        
        let urlStr = "http://127.0.0.1:\(currentPort)/api/realtime?clientId=companion_macos_\(ProcessInfo.processInfo.processIdentifier)&role=observer"
        guard let url = URL(string: urlStr) else { return }
        
        let delegate = SSEStreamDelegate { [weak self] line in
            self?.handleSSELine(line)
        }
        
        let config = URLSessionConfiguration.default
        config.timeoutIntervalForRequest = TimeInterval(3600)
        config.timeoutIntervalForResource = TimeInterval(86400)
        
        let session = URLSession(configuration: config, delegate: delegate, delegateQueue: nil)
        let task = session.dataTask(with: url)
        task.resume()
        
        self.sseSession = session
        self.sseTask = task
    }
    
    private func stopRealtimeListener() {
        sseTask?.cancel()
        sseTask = nil
        sseSession?.invalidateAndCancel()
        sseSession = nil
    }
    
    private func handleSSELine(_ line: String) {
        guard line.hasPrefix("data:") else { return }
        let jsonStr = line.dropFirst(5).trimmingCharacters(in: .whitespaces)
        guard let data = jsonStr.data(using: .utf8),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return }
        
        if let type = json["type"] as? String {
            if (type == "presence" || type == "connected"), let count = json["onlineUsers"] as? Int {
                DispatchQueue.main.async {
                    self.onlineCount = count
                    self.onStatusChanged?()
                }
            } else if type == "patients_list_changed" || type == "patient_updated" {
                fetchServerStats()
            } else if type == "server_updating" {
                // Update initiated: keep companion and server running so download & extraction complete safely.
                DispatchQueue.main.async {
                    self.onStatusChanged?()
                }
            }
        }
    }
    
    private func fetchServerStats() {
        guard isRunning else { return }
        let url = URL(string: "http://127.0.0.1:3000/api/network")!
        let task = URLSession.shared.dataTask(with: url) { [weak self] data, response, error in
            guard let data = data,
                  let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return }
            
            DispatchQueue.main.async {
                if let online = json["onlineCount"] as? Int {
                    self?.onlineCount = online
                }
                if let stats = json["stats"] as? [String: Any] {
                    self?.totalPatients = stats["totalPatients"] as? Int ?? 0
                    self?.todayPatients = stats["todayPatients"] as? Int ?? 0
                }
                if let backup = json["latestBackupTime"] as? String {
                    self?.latestBackupTime = backup
                }
                self?.onStatusChanged?()
            }
        }
        task.resume()
    }
    
    private func pollForServerReady(attempt: Int = 0) {
        guard attempt < 30, isRunning else { return }
        
        let url = URL(string: "http://127.0.0.1:3000/api/network")!
        let task = URLSession.shared.dataTask(with: url) { [weak self] data, response, error in
            if let data = data,
               let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
               let lan = json["lanUrl"] as? String,
               let port = json["port"] as? Int {
                
                let mdns = json["mdnsUrl"] as? String ?? "http://clinic.local:\(port)"
                
                var qr: NSImage? = nil
                if let qrDataUrl = json["qrCodeDataUrl"] as? String,
                   let base64 = qrDataUrl.components(separatedBy: ",").last,
                   let imgData = Data(base64Encoded: base64) {
                    qr = NSImage(data: imgData)
                }
                
                DispatchQueue.main.async {
                    self?.lanUrl = lan
                    self?.mdnsUrl = mdns
                    self?.currentPort = port
                    self?.qrImage = qr
                    
                    if self?.netService == nil {
                        let service = NetService(domain: "local.", type: "_http._tcp.", name: "clinic", port: Int32(port))
                        service.publish()
                        self?.netService = service
                    }
                    
                    if let online = json["onlineCount"] as? Int {
                        self?.onlineCount = online
                    }
                    if let stats = json["stats"] as? [String: Any] {
                        self?.totalPatients = stats["totalPatients"] as? Int ?? 0
                        self?.todayPatients = stats["todayPatients"] as? Int ?? 0
                    }
                    if let backup = json["latestBackupTime"] as? String {
                        self?.latestBackupTime = backup
                    }
                    self?.onStatusChanged?()
                    self?.startRealtimeListener()
                    
                    // Open browser EXACTLY once on startup
                    if !(self?.hasOpenedBrowserThisRun ?? true) {
                        self?.hasOpenedBrowserThisRun = true
                        let openUrl = URL(string: mdns) ?? URL(string: lan)
                        if let browserUrl = openUrl {
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
    
    // Live Stats Widgets
    private var lblOnlineCount: NSTextField!
    private var lblTotalPatients: NSTextField!
    private var lblTodayPatients: NSTextField!
    
    private var urlField: NSTextField!
    private var copyButton: NSButton!
    private var openBrowserButton: NSButton!
    private var lblLanSub: NSTextField!
    private var qrImageView: NSImageView!
    
    private var toggleButton: NSButton!
    private var restartButton: NSButton!
    private var quickBackupButton: NSButton!
    private var backupsButton: NSButton!
    private var shortcutButton: NSButton!
    private var updateButton: NSButton!
    
    convenience init() {
        let window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 460, height: 630),
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
        
        // Ensure Desktop Shortcut exists on initial launch
        setupDesktopShortcutSilently()
    }
    
    private func setupUI() {
        guard let contentView = window?.contentView else { return }
        
        let currentVer = getCurrentAppVersion()
        window?.title = "سجلات العيادة الطبية - لوحة التحكم (\(currentVer))"

        // 1. Header Title
        let titleLabel = NSTextField(labelWithString: "لوحة تحكم خادم العيادة")
        titleLabel.font = NSFont.boldSystemFont(ofSize: 18)
        titleLabel.alignment = .center
        titleLabel.frame = NSRect(x: 20, y: 585, width: 420, height: 26)
        contentView.addSubview(titleLabel)
        
        // 2. Status Box
        statusDot = NSTextField(labelWithString: "●")
        statusDot.font = NSFont.systemFont(ofSize: 18)
        statusDot.textColor = .systemGreen
        statusDot.frame = NSRect(x: 155, y: 550, width: 20, height: 22)
        contentView.addSubview(statusDot)
        
        statusLabel = NSTextField(labelWithString: "الخادم قيد الإقلاع...")
        statusLabel.font = NSFont.boldSystemFont(ofSize: 14)
        statusLabel.frame = NSRect(x: 180, y: 551, width: 160, height: 22)
        contentView.addSubview(statusLabel)
        
        // 3. Live Stats Box (3 Columns)
        let statsBox = NSBox(frame: NSRect(x: 25, y: 475, width: 410, height: 65))
        statsBox.title = "حالة الاتصال والبيانات الحية"
        statsBox.titlePosition = .atTop
        
        lblOnlineCount = NSTextField(labelWithString: "👥 المتصلون: 1")
        lblOnlineCount.font = NSFont.boldSystemFont(ofSize: 11)
        lblOnlineCount.frame = NSRect(x: 10, y: 8, width: 120, height: 20)
        lblOnlineCount.textColor = .systemTeal
        statsBox.contentView?.addSubview(lblOnlineCount)
        
        lblTotalPatients = NSTextField(labelWithString: "📋 إجمالي المرضى: 0")
        lblTotalPatients.font = NSFont.boldSystemFont(ofSize: 11)
        lblTotalPatients.frame = NSRect(x: 135, y: 8, width: 140, height: 20)
        statsBox.contentView?.addSubview(lblTotalPatients)
        
        lblTodayPatients = NSTextField(labelWithString: "📅 اليوم: 0")
        lblTodayPatients.font = NSFont.boldSystemFont(ofSize: 11)
        lblTodayPatients.frame = NSRect(x: 285, y: 8, width: 110, height: 20)
        statsBox.contentView?.addSubview(lblTodayPatients)
        
        contentView.addSubview(statsBox)
        
        // 4. Network URL Section
        let urlTitle = NSTextField(labelWithString: "🌐 رابط الوصول الدائم (الثابت دائماً):")
        urlTitle.font = NSFont.boldSystemFont(ofSize: 12)
        urlTitle.frame = NSRect(x: 30, y: 445, width: 400, height: 18)
        contentView.addSubview(urlTitle)
        
        urlField = NSTextField(string: "http://clinic.local:3000")
        urlField.isEditable = false
        urlField.font = NSFont.monospacedSystemFont(ofSize: 13, weight: .medium)
        urlField.frame = NSRect(x: 30, y: 415, width: 260, height: 26)
        contentView.addSubview(urlField)
        
        copyButton = NSButton(title: "نسخ", target: self, action: #selector(copyUrlClicked))
        copyButton.bezelStyle = .rounded
        copyButton.frame = NSRect(x: 295, y: 411, width: 65, height: 32)
        contentView.addSubview(copyButton)
        
        openBrowserButton = NSButton(title: "فتح", target: self, action: #selector(openBrowserClicked))
        openBrowserButton.bezelStyle = .rounded
        openBrowserButton.frame = NSRect(x: 365, y: 411, width: 65, height: 32)
        contentView.addSubview(openBrowserButton)
        
        lblLanSub = NSTextField(labelWithString: "📶 رابط الشبكة المباشر (IP البديل): --")
        lblLanSub.font = NSFont.systemFont(ofSize: 10.5)
        lblLanSub.textColor = .secondaryLabelColor
        lblLanSub.frame = NSRect(x: 30, y: 395, width: 400, height: 16)
        contentView.addSubview(lblLanSub)
        
        // 5. QR Code Box
        let qrBox = NSBox(frame: NSRect(x: 110, y: 195, width: 240, height: 195))
        qrBox.title = "رمز الدخول السريع (QR)"
        qrBox.titlePosition = .atTop
        
        qrImageView = NSImageView()
        qrImageView.imageScaling = .scaleProportionallyUpOrDown
        qrImageView.translatesAutoresizingMaskIntoConstraints = false
        if let container = qrBox.contentView {
            container.addSubview(qrImageView)
            NSLayoutConstraint.activate([
                qrImageView.centerXAnchor.constraint(equalTo: container.centerXAnchor),
                qrImageView.centerYAnchor.constraint(equalTo: container.centerYAnchor, constant: -5),
                qrImageView.widthAnchor.constraint(equalToConstant: 146),
                qrImageView.heightAnchor.constraint(equalToConstant: 146)
            ])
        }
        contentView.addSubview(qrBox)
        
        let qrHint = NSTextField(labelWithString: "امسح الرمز من الهاتف أو التابلت للفتح المباشر")
        qrHint.font = NSFont.systemFont(ofSize: 11)
        qrHint.textColor = .secondaryLabelColor
        qrHint.alignment = .center
        qrHint.frame = NSRect(x: 20, y: 172, width: 420, height: 18)
        contentView.addSubview(qrHint)
        
        // 6. Action Buttons Grid
        // Row 1: Start/Stop & Restart
        toggleButton = NSButton(title: "إيقاف السيرفر", target: self, action: #selector(toggleServerClicked))
        toggleButton.bezelStyle = .rounded
        toggleButton.frame = NSRect(x: 30, y: 125, width: 195, height: 34)
        contentView.addSubview(toggleButton)
        
        restartButton = NSButton(title: "إعادة تشغيل", target: self, action: #selector(restartServerClicked))
        restartButton.bezelStyle = .rounded
        restartButton.frame = NSRect(x: 235, y: 125, width: 195, height: 34)
        contentView.addSubview(restartButton)
        
        // Row 2: Quick Backup Now & Backups Folder
        quickBackupButton = NSButton(title: "أخذ نسخة احتياطية الآن", target: self, action: #selector(quickBackupClicked))
        quickBackupButton.bezelStyle = .rounded
        quickBackupButton.frame = NSRect(x: 30, y: 85, width: 195, height: 34)
        contentView.addSubview(quickBackupButton)

        backupsButton = NSButton(title: "مجلد النسخ الاحتياطية", target: self, action: #selector(openBackupsClicked))
        backupsButton.bezelStyle = .rounded
        backupsButton.frame = NSRect(x: 235, y: 85, width: 195, height: 34)
        contentView.addSubview(backupsButton)
        
        // Row 3: Desktop Shortcut & Update Checker
        shortcutButton = NSButton(title: "اختصار سطح المكتب", target: self, action: #selector(createShortcutClicked))
        shortcutButton.bezelStyle = .rounded
        shortcutButton.frame = NSRect(x: 30, y: 48, width: 195, height: 32)
        contentView.addSubview(shortcutButton)

        updateButton = NSButton(title: "فحص التحديثات", target: self, action: #selector(checkUpdatesClicked))
        updateButton.bezelStyle = .rounded
        updateButton.frame = NSRect(x: 235, y: 48, width: 195, height: 32)
        contentView.addSubview(updateButton)
        
        // 7. Footer Hint
        let footerHint = NSTextField(labelWithString: "Clinic Records \(currentVer)  •  ⓘ إغلاق هذه النافذة يُبقي السيرفر يعمل في شريط القوائم العلوي")
        footerHint.font = NSFont.systemFont(ofSize: 10.5)
        footerHint.textColor = .tertiaryLabelColor
        footerHint.alignment = .center
        footerHint.frame = NSRect(x: 20, y: 18, width: 420, height: 18)
        contentView.addSubview(footerHint)
        
        updateUI()
    }
    
    func updateUI() {
        let isRunning = ServerManager.shared.isRunning
        statusDot.textColor = isRunning ? .systemGreen : .systemRed
        statusLabel.stringValue = isRunning ? "الخادم يعمل بنجاح" : "الخادم متوقف حالياً"
        toggleButton.title = isRunning ? "إيقاف السيرفر" : "تشغيل السيرفر"
        restartButton.isEnabled = isRunning
        quickBackupButton.isEnabled = isRunning
        
        if !ServerManager.shared.mdnsUrl.isEmpty {
            urlField.stringValue = ServerManager.shared.mdnsUrl
        } else if !ServerManager.shared.lanUrl.isEmpty {
            urlField.stringValue = ServerManager.shared.lanUrl
        }
        
        if !ServerManager.shared.lanUrl.isEmpty {
            lblLanSub.stringValue = "📶 رابط الشبكة المباشر (IP البديل): \(ServerManager.shared.lanUrl)"
        }
        
        if let qr = ServerManager.shared.qrImage {
            qrImageView.image = qr
        }
        
        lblOnlineCount.stringValue = "👥 المتصلون: \(ServerManager.shared.onlineCount)"
        lblTotalPatients.stringValue = "📋 إجمالي المرضى: \(ServerManager.shared.totalPatients)"
        lblTodayPatients.stringValue = "📅 اليوم: \(ServerManager.shared.todayPatients)"
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
    
    @objc private func restartServerClicked() {
        ServerManager.shared.stopServer()
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.6) {
            ServerManager.shared.startServer()
        }
    }
    
    @objc private func quickBackupClicked() {
        guard ServerManager.shared.isRunning else {
            let alert = NSAlert()
            alert.messageText = "الخادم متوقف"
            alert.informativeText = "يجب تشغيل السيرفر أولاً لتتمكن من أخذ نسخة احتياطية."
            alert.alertStyle = .warning
            alert.runModal()
            return
        }
        
        let port = ServerManager.shared.currentPort
        guard let url = URL(string: "http://127.0.0.1:\(port)/api/backup") else { return }
        
        quickBackupButton.isEnabled = false
        quickBackupButton.title = "جارٍ النسخ..."
        
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.timeoutInterval = 30
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = "{}".data(using: .utf8)
        
        URLSession.shared.dataTask(with: request) { [weak self] data, response, error in
            DispatchQueue.main.async {
                self?.quickBackupButton.isEnabled = true
                self?.quickBackupButton.title = "💾 أخذ نسخة احتياطية الآن"
                
                if let httpResp = response as? HTTPURLResponse, httpResp.statusCode == 200 {
                    let alert = NSAlert()
                    alert.messageText = "تم إنشاء النسخة الاحتياطية بنجاح! 💾"
                    alert.informativeText = "تم حفظ نسخة احتياطية مؤمنة لقاعدة البيانات في مجلد النسخ الاحتياطية."
                    alert.alertStyle = .informational
                    alert.runModal()
                } else {
                    let alert = NSAlert()
                    alert.messageText = "تعذر أخذ النسخة الاحتياطية"
                    alert.informativeText = error?.localizedDescription ?? "حدث خطأ أثناء الاتصال بالخادم المحلي."
                    alert.alertStyle = .warning
                    alert.runModal()
                }
            }
        }.resume()
    }

    @objc private func openBackupsClicked() {
        let backupDir = "\(ServerManager.shared.workingDir)/backups"
        let url = URL(fileURLWithPath: backupDir)
        try? FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
        NSWorkspace.shared.selectFile(nil, inFileViewerRootedAtPath: url.path)
    }
    
    @objc private func createShortcutClicked() {
        let fm = FileManager.default
        let desktop = fm.homeDirectoryForCurrentUser.appendingPathComponent("Desktop")
        let shortcut = desktop.appendingPathComponent("سجلات العيادة الطبية.app")
        do {
            if fm.fileExists(atPath: shortcut.path) {
                try fm.removeItem(at: shortcut)
            }
            try fm.createSymbolicLink(at: shortcut, withDestinationURL: Bundle.main.bundleURL)
            let alert = NSAlert()
            alert.messageText = "تم إنشاء الاختصار بنجاح!"
            alert.informativeText = "تم وضع اختصار للبرنامج على سطح المكتب (Desktop)."
            alert.runModal()
        } catch {
            let alert = NSAlert()
            alert.messageText = "تعذر إنشاء الاختصار"
            alert.informativeText = error.localizedDescription
            alert.runModal()
        }
    }
    
    private func setupDesktopShortcutSilently() {
        let fm = FileManager.default
        let desktop = fm.homeDirectoryForCurrentUser.appendingPathComponent("Desktop")
        let shortcut = desktop.appendingPathComponent("سجلات العيادة الطبية.app")
        if !fm.fileExists(atPath: shortcut.path) {
            try? fm.createSymbolicLink(at: shortcut, withDestinationURL: Bundle.main.bundleURL)
        }
    }
    
    private var activeProgressController: UpdateProgressWindowController?
    
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
                self?.updateButton.title = "🔄 فحص التحديثات"
                
                guard let data = data,
                      let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                      let latestTag = json["tag_name"] as? String else {
                    let alert = NSAlert()
                    alert.messageText = "تعذر التحقق من التحديثات"
                    alert.informativeText = "تأكد من اتصالك بالإنترنت وحاول مرة أخرى."
                    alert.runModal()
                    return
                }
                
                let currentVer = self?.getCurrentAppVersion() ?? "v1.0.0"
                if latestTag.compare(currentVer, options: .numeric) == .orderedDescending {
                    let htmlUrl = json["html_url"] as? String ?? "https://github.com/clinic-records/clinic-records.github.io/releases"
                    let alert = NSAlert()
                    alert.messageText = "يوجد تحديث جديد متاح (\(latestTag))!"
                    alert.informativeText = "الإصدار الحالي: \(currentVer)\nالإصدار الأحدث: \(latestTag)\n\nهل ترغب في تثبيت التحديث وإعادة تشغيل المنظومة تلقائياً الآن؟\n(ملاحظة: سيتم أخذ نسخة احتياطية تأمينية للبيانات تلقائياً قبل بدء التحديث)"
                    alert.addButton(withTitle: "تثبيت التحديث الآن")
                    alert.addButton(withTitle: "إلغاء")
                    let res = alert.runModal()
                    if res == .alertFirstButtonReturn {
                        self?.startInPlaceUpdate(latestTag: latestTag, htmlUrl: htmlUrl)
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
    
    private func startInPlaceUpdate(latestTag: String, htmlUrl: String) {
        guard ServerManager.shared.isRunning else {
            let alert = NSAlert()
            alert.messageText = "الخادم متوقف حالياً"
            alert.informativeText = "يرجى تشغيل السيرفر أولاً لتتمكن المنظومة من تنزيل وتثبيت التحديث تلقائياً."
            alert.alertStyle = .warning
            alert.runModal()
            return
        }

        let port = ServerManager.shared.currentPort
        guard let url = URL(string: "http://127.0.0.1:\(port)/api/system/update/install") else { return }

        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.timeoutInterval = 30
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = "{}".data(using: .utf8)

        URLSession.shared.dataTask(with: req) { [weak self] data, response, error in
            DispatchQueue.main.async {
                if let httpResp = response as? HTTPURLResponse {
                    if httpResp.statusCode == 409 {
                        let alert = NSAlert()
                        alert.messageText = "التحديث قيد التنفيذ بالفعل"
                        alert.informativeText = "عملية التحديث قيد التنفيذ بالفعل حالياً من قبل مستخدم أو شاشة أخرى."
                        alert.alertStyle = .informational
                        alert.runModal()
                        return
                    } else if httpResp.statusCode == 200 {
                        // Open live progress tracking window
                        self?.activeProgressController = UpdateProgressWindowController(port: port, htmlUrl: htmlUrl)
                        self?.activeProgressController?.showWindow(nil)
                        return
                    }
                }
                
                // If failed to start, offer to open github
                let alert = NSAlert()
                alert.messageText = "تعذر بدء التحديث التلقائي"
                alert.informativeText = error?.localizedDescription ?? "حدث خطأ أثناء التواصل مع السيرفر المحلي لبدء التحديث.\nهل ترغب في فتح صفحة التحميل يدوياً؟"
                alert.addButton(withTitle: "فتح صفحة التحميل")
                alert.addButton(withTitle: "إلغاء")
                if alert.runModal() == .alertFirstButtonReturn, let u = URL(string: htmlUrl) {
                    NSWorkspace.shared.open(u)
                }
            }
        }.resume()
    }
    
    private func getCurrentAppVersion() -> String {
        if let infoVer = Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String, !infoVer.isEmpty {
            return infoVer.hasPrefix("v") ? infoVer : "v\(infoVer)"
        }
        let pkgPath = "\(ServerManager.shared.workingDir)/package.json"
        if let data = try? Data(contentsOf: URL(fileURLWithPath: pkgPath)),
           let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
           let v = json["version"] as? String {
            return v.hasPrefix("v") ? v : "v\(v)"
        }
        return "v1.0.0"
    }
    
    func windowShouldClose(_ sender: NSWindow) -> Bool {
        sender.orderOut(nil)
        return false
    }
}

class UpdateProgressWindowController: NSWindowController {
    private var progressIndicator: NSProgressIndicator!
    private var statusLabel: NSTextField!
    private var percentLabel: NSTextField!
    private var pollTimer: Timer?
    private var port: Int
    private var htmlUrl: String
    
    init(port: Int, htmlUrl: String) {
        self.port = port
        self.htmlUrl = htmlUrl
        let window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 440, height: 165),
            styleMask: [.titled, .closable],
            backing: .buffered,
            defer: false
        )
        window.center()
        window.title = "تحديث سجلات العيادة الطبية"
        window.isReleasedWhenClosed = false
        super.init(window: window)
        setupUI()
    }
    
    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }
    
    private func setupUI() {
        guard let contentView = window?.contentView else { return }
        
        let titleLabel = NSTextField(labelWithString: "جارٍ تثبيت تحديث المنظومة...")
        titleLabel.font = NSFont.boldSystemFont(ofSize: 14)
        titleLabel.alignment = .right
        titleLabel.frame = NSRect(x: 20, y: 120, width: 400, height: 22)
        contentView.addSubview(titleLabel)
        
        statusLabel = NSTextField(labelWithString: "جارٍ أخذ نسخة احتياطية تأمينية وبدء التنزيل...")
        statusLabel.font = NSFont.systemFont(ofSize: 12)
        statusLabel.textColor = .secondaryLabelColor
        statusLabel.alignment = .right
        statusLabel.frame = NSRect(x: 20, y: 88, width: 400, height: 20)
        contentView.addSubview(statusLabel)
        
        progressIndicator = NSProgressIndicator(frame: NSRect(x: 20, y: 48, width: 335, height: 20))
        progressIndicator.isIndeterminate = false
        progressIndicator.minValue = 0
        progressIndicator.maxValue = 100
        progressIndicator.doubleValue = 5
        contentView.addSubview(progressIndicator)
        
        percentLabel = NSTextField(labelWithString: "5%")
        percentLabel.font = NSFont.monospacedSystemFont(ofSize: 12, weight: .bold)
        percentLabel.alignment = .left
        percentLabel.frame = NSRect(x: 365, y: 48, width: 55, height: 20)
        contentView.addSubview(percentLabel)
        
        let footerHint = NSTextField(labelWithString: "ⓘ لا تغلق هذه النافذة حتى تكتمل عملية التحديث وإعادة التشغيل")
        footerHint.font = NSFont.systemFont(ofSize: 10.5)
        footerHint.textColor = .tertiaryLabelColor
        footerHint.alignment = .center
        footerHint.frame = NSRect(x: 20, y: 16, width: 400, height: 18)
        contentView.addSubview(footerHint)
        
        startPolling()
    }
    
    private func startPolling() {
        pollTimer = Timer.scheduledTimer(withTimeInterval: 0.5, repeats: true) { [weak self] _ in
            self?.checkStatus()
        }
    }
    
    private func checkStatus() {
        guard let url = URL(string: "http://127.0.0.1:\(port)/api/system/update/status") else { return }
        URLSession.shared.dataTask(with: url) { [weak self] data, response, error in
            guard let data = data,
                  let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                  let status = json["status"] as? String else { return }
            
            let progress = json["progress"] as? Double ?? 0
            let message = json["message"] as? String ?? ""
            
            DispatchQueue.main.async {
                self?.progressIndicator.doubleValue = progress
                self?.percentLabel.stringValue = "\(Int(progress))%"
                if !message.isEmpty {
                    self?.statusLabel.stringValue = message
                }
                
                if status == "ready" {
                    self?.pollTimer?.invalidate()
                    self?.statusLabel.stringValue = "✅ تم تجهيز التحديث بنجاح! سيتم إغلاق البرنامج وإعادة التشغيل تلقائياً..."
                    self?.progressIndicator.doubleValue = 100
                    self?.percentLabel.stringValue = "100%"
                    DispatchQueue.main.asyncAfter(deadline: .now() + 1.2) {
                        NSApplication.shared.terminate(nil)
                    }
                } else if status == "error" {
                    self?.pollTimer?.invalidate()
                    self?.window?.close()
                    let err = json["error"] as? String ?? "فشلت عملية التحديث"
                    let alert = NSAlert()
                    alert.messageText = "تعذر إكمال التحديث"
                    alert.informativeText = "\(err)\n\nهل ترغب في فتح صفحة التحميل للحصول على النسخة يدوياً؟"
                    alert.addButton(withTitle: "فتح صفحة التحميل")
                    alert.addButton(withTitle: "إلغاء")
                    if alert.runModal() == .alertFirstButtonReturn, let u = URL(string: self?.htmlUrl ?? "") {
                        NSWorkspace.shared.open(u)
                    }
                }
            }
        }.resume()
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
