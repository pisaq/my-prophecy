import Foundation
import CoreMIDI
import Darwin

// Bridging header: MultitouchSupport private API. Build with ./build.sh

private let lowC: UInt8 = 36
private let highC: UInt8 = 96
private let midiChannel: UInt8 = 0
private let controlPort: UInt16 = 17321

private var midiClient = MIDIClientRef()
private var virtualSource = MIDIEndpointRef()
private var outputPort = MIDIPortRef()
private var hardwareDest: MIDIEndpointRef = 0
private var currentNote: UInt8? = nil
private let noteLock = NSLock()

private var mtDevice: MTDeviceRef?
private var captureEnabled = false
private var preferredOut = ""
private let stateLock = NSLock()

@main
struct TrackpadMidi {
  static func main() {
    let args = CommandLine.arguments
    if args.contains("--help") || args.contains("-h") {
      printUsage()
      return
    }

    preferredOut = argValue("--out") ?? ""

    print("my-prophecy trackpad companion")
    print("Control API: http://127.0.0.1:\(controlPort)")
    print("Virtual MIDI: “my-prophecy Trackpad”")
    print("Leave this running — the website Enable/Disable button talks to it.")
    print("Ctrl+C to quit.")
    print("")

    guard setupMIDI() else {
      fputs("Failed to create CoreMIDI virtual source.\n", stderr)
      exit(1)
    }

    if !preferredOut.isEmpty {
      _ = openHardwareOutput(named: preferredOut)
    }

    guard prepareTrackpad() else {
      fputs("Failed to open MultitouchSupport. Need a MacBook / Magic Trackpad.\n", stderr)
      exit(1)
    }

    // Immediate capture unless --daemon (wait for /start from the website)
    let daemon = args.contains("--daemon")
    if !daemon {
      setCapture(true)
      print("Trackpad capture: ON (pass --daemon to start off and use the website button)")
    } else {
      print("Trackpad capture: OFF — use Enable in the website")
    }

    signal(SIGINT) { _ in
      setCapture(false)
      exit(0)
    }

    DispatchQueue.global(qos: .userInitiated).async {
      runControlServer(port: controlPort)
    }

    RunLoop.main.run()
  }
}

private func printUsage() {
  print("""
  my-prophecy trackpad → MIDI companion

    trackpad-midi                 Start capture immediately + control API
    trackpad-midi --daemon        Control API only; website Enable starts capture
    trackpad-midi --out MidiLink  Also send notes to a hardware/virtual destination
    trackpad-midi --help

  Control API (CORS enabled for any published site):
    GET  http://127.0.0.1:17321/status
    POST http://127.0.0.1:17321/start
    POST http://127.0.0.1:17321/stop
  """)
}

private func argValue(_ flag: String) -> String? {
  let args = CommandLine.arguments
  guard let i = args.firstIndex(of: flag), args.index(after: i) < args.endIndex else { return nil }
  return args[args.index(after: i)]
}

// MARK: - Capture state

private func setCapture(_ on: Bool) {
  stateLock.lock()
  captureEnabled = on
  stateLock.unlock()
  if !on {
    releaseNote()
    print("\nCapture OFF")
  } else {
    if !preferredOut.isEmpty {
      _ = openHardwareOutput(named: preferredOut)
    }
    print("\nCapture ON — touch the trackpad")
  }
}

private func isCapturing() -> Bool {
  stateLock.lock()
  defer { stateLock.unlock() }
  return captureEnabled
}

private func statusJSON() -> String {
  let running = isCapturing()
  let out = preferredOut.replacingOccurrences(of: "\"", with: "")
  return """
  {"running":\(running),"out":\(out.isEmpty ? "null" : "\"\(out)\""),"port":\(controlPort),"name":"my-prophecy Trackpad","companion":true}
  """
}

// MARK: - HTTP control server (localhost only)

private func runControlServer(port: UInt16) {
  let fd = socket(AF_INET, SOCK_STREAM, 0)
  guard fd >= 0 else {
    fputs("Control server: socket() failed\n", stderr)
    return
  }

  var yes: Int32 = 1
  setsockopt(fd, SOL_SOCKET, SO_REUSEADDR, &yes, socklen_t(MemoryLayout.size(ofValue: yes)))

  var addr = sockaddr_in()
  addr.sin_len = UInt8(MemoryLayout<sockaddr_in>.size)
  addr.sin_family = sa_family_t(AF_INET)
  addr.sin_port = port.bigEndian
  addr.sin_addr = in_addr(s_addr: inet_addr("127.0.0.1"))

  let bindResult = withUnsafePointer(to: &addr) {
    $0.withMemoryRebound(to: sockaddr.self, capacity: 1) {
      bind(fd, $0, socklen_t(MemoryLayout<sockaddr_in>.size))
    }
  }
  guard bindResult == 0 else {
    fputs("Control server: could not bind 127.0.0.1:\(port) (already running?)\n", stderr)
    close(fd)
    return
  }
  guard listen(fd, 8) == 0 else {
    fputs("Control server: listen() failed\n", stderr)
    close(fd)
    return
  }

  print("Control server listening on http://127.0.0.1:\(port)")

  while true {
    let client = accept(fd, nil, nil)
    if client < 0 { continue }
    DispatchQueue.global(qos: .userInitiated).async {
      handleHTTP(client: client)
    }
  }
}

private func handleHTTP(client: Int32) {
  defer { close(client) }
  var buffer = [UInt8](repeating: 0, count: 8192)
  let n = read(client, &buffer, buffer.count)
  guard n > 0 else { return }
  let request = String(bytes: buffer[0..<n], encoding: .utf8) ?? ""
  let firstLine = request.split(separator: "\r\n").first.map(String.init) ?? ""
  let parts = firstLine.split(separator: " ")
  let method = parts.count > 0 ? String(parts[0]) : ""
  let path = parts.count > 1 ? String(parts[1]) : "/"

  // Optional JSON body for /start {"out":"MidiLink"}
  if method == "POST", path.hasPrefix("/start") || path == "/start" {
    if let bodyStart = request.range(of: "\r\n\r\n")?.upperBound {
      let body = String(request[bodyStart...])
      if let data = body.data(using: .utf8),
         let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
         let out = obj["out"] as? String {
        preferredOut = out.trimmingCharacters(in: .whitespacesAndNewlines)
      }
    }
  }

  let route = path.split(separator: "?").first.map(String.init) ?? path

  if method == "OPTIONS" {
    writeHTTP(client: client, status: 204, body: "", contentType: "text/plain")
    return
  }

  switch (method, route) {
  case ("GET", "/"), ("GET", "/health"):
    let html = """
    <!doctype html><meta charset=utf-8><title>my-prophecy trackpad</title>
    <body style="font:14px -apple-system;background:#111;color:#eee;padding:2rem">
    <h1>my-prophecy trackpad companion</h1>
    <p>Running. Keep this process open and use Enable/Disable on the website.</p>
    <pre>\(statusJSON())</pre>
    </body>
    """
    writeHTTP(client: client, status: 200, body: html, contentType: "text/html; charset=utf-8")

  case ("GET", "/status"):
    writeHTTP(client: client, status: 200, body: statusJSON(), contentType: "application/json")

  case ("POST", "/start"):
    setCapture(true)
    writeHTTP(client: client, status: 200, body: statusJSON(), contentType: "application/json")

  case ("POST", "/stop"):
    setCapture(false)
    writeHTTP(client: client, status: 200, body: statusJSON(), contentType: "application/json")

  default:
    writeHTTP(client: client, status: 404, body: "{\"error\":\"not found\"}", contentType: "application/json")
  }
}

private func writeHTTP(client: Int32, status: Int, body: String, contentType: String) {
  let reason = status == 200 ? "OK" : status == 204 ? "No Content" : status == 404 ? "Not Found" : "Error"
  let data = Array(body.utf8)
  let header = """
  HTTP/1.1 \(status) \(reason)\r
  Content-Type: \(contentType)\r
  Content-Length: \(data.count)\r
  Access-Control-Allow-Origin: *\r
  Access-Control-Allow-Methods: GET, POST, OPTIONS\r
  Access-Control-Allow-Headers: Content-Type\r
  Connection: close\r
  \r

  """
  header.withCString { ptr in
    _ = write(client, ptr, strlen(ptr))
  }
  if !data.isEmpty {
    data.withUnsafeBytes { raw in
      _ = write(client, raw.baseAddress, data.count)
    }
  }
}

// MARK: - MIDI

private func setupMIDI() -> Bool {
  var status = MIDIClientCreate("my-prophecy trackpad" as CFString, nil, nil, &midiClient)
  guard status == noErr else { return false }
  status = MIDISourceCreate(midiClient, "my-prophecy Trackpad" as CFString, &virtualSource)
  guard status == noErr else { return false }
  status = MIDIOutputPortCreate(midiClient, "my-prophecy out" as CFString, &outputPort)
  return status == noErr
}

private func openHardwareOutput(named needle: String) -> Bool {
  hardwareDest = 0
  let n = MIDIGetNumberOfDestinations()
  let lower = needle.lowercased()
  for i in 0..<n {
    let dest = MIDIGetDestination(i)
    if endpointName(dest).lowercased().contains(lower) {
      hardwareDest = dest
      print("Also sending to hardware: \(endpointName(dest))")
      return true
    }
  }
  if !needle.isEmpty {
    fputs("No MIDI output matching “\(needle)”. Virtual port only.\n", stderr)
  }
  return false
}

private func endpointName(_ endpoint: MIDIEndpointRef) -> String {
  var param: Unmanaged<CFString>?
  guard MIDIObjectGetStringProperty(endpoint, kMIDIPropertyDisplayName, &param) == noErr,
        let name = param?.takeRetainedValue() as String?
  else { return "(unknown)" }
  return name
}

// MARK: - Trackpad

private func prepareTrackpad() -> Bool {
  guard let device = MTDeviceCreateDefault() else { return false }
  mtDevice = device
  MTRegisterContactFrameCallback(device, touchCallback)
  let status = MTDeviceStart(device, 0)
  return status == noErr
}

private let touchCallback: MTFrameCallbackFunction = { _, touches, numTouches, _, _ in
  guard isCapturing() else {
    releaseNote()
    return
  }
  guard let touches else {
    releaseNote()
    return
  }

  var best: MTTouch? = nil
  for i in 0..<numTouches {
    let t = touches[i]
    if t.state == Int32(MTTouchStateTouching) || t.state == Int32(MTTouchStateMakeTouch) {
      if best == nil || t.pathIndex < best!.pathIndex {
        best = t
      }
    }
  }

  guard let touch = best else {
    releaseNote()
    return
  }

  let x = Double(touch.normalizedVector.position.x)
  let yFromTop = 1.0 - Double(touch.normalizedVector.position.y)
  let note = noteFromXY(x: x, yFromTop: yFromTop)
  let size = max(0.05, min(1.0, Double(touch.zTotal)))
  let velocity = UInt8(max(1, min(127, Int(40 + size * 87))))

  noteLock.lock()
  defer { noteLock.unlock() }

  if currentNote == note { return }
  if let prev = currentNote {
    sendMidi([0x80 | midiChannel, prev, 0])
  }
  sendMidi([0x90 | midiChannel, note, velocity])
  currentNote = note
  fputs("\r\(noteName(note))  \(note)  vel \(velocity)   ", stdout)
  fflush(stdout)
}

private func releaseNote() {
  noteLock.lock()
  defer { noteLock.unlock() }
  guard let note = currentNote else { return }
  sendMidi([0x80 | midiChannel, note, 0])
  sendMidi([0x90 | midiChannel, note, 0])
  currentNote = nil
  fputs("\r— idle                    ", stdout)
  fflush(stdout)
}

private func noteFromXY(x: Double, yFromTop: Double) -> UInt8 {
  let clampedX = min(1, max(0, x))
  let clampedY = min(1, max(0, yFromTop))
  let fromX = Double(lowC) + clampedX * Double(highC - lowC)
  let fromY = Double(highC) - clampedY * Double(highC - lowC)
  let n = Int(((fromX + fromY) / 2.0).rounded())
  return UInt8(min(Int(highC), max(Int(lowC), n)))
}

private func sendMidi(_ bytes: [UInt8]) {
  var packet = MIDIPacket()
  packet.timeStamp = 0
  packet.length = UInt16(bytes.count)
  withUnsafeMutableBytes(of: &packet.data) { buf in
    for (i, b) in bytes.enumerated() {
      buf[i] = b
    }
  }
  var packetList = MIDIPacketList(numPackets: 1, packet: packet)
  MIDIReceived(virtualSource, &packetList)
  if hardwareDest != 0 {
    MIDISend(outputPort, hardwareDest, &packetList)
  }
}

private func noteName(_ n: UInt8) -> String {
  let names = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]
  let note = Int(n)
  return "\(names[note % 12])\(note / 12 - 1)"
}
