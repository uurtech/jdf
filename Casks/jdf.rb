cask "jdf" do
  version "0.1.22"
  sha256 "2dc0a7ecda8a18cfc32c842db1a06d1b474fc593aa26a2a7609aff44730ba9cd"

  url "https://github.com/uurtech/jdf/releases/download/v#{version}/JDF.Reader_#{version}_aarch64.dmg"
  name "JDF Reader"
  desc "Viewer and editor for the JDF (JSON Document Format)"
  homepage "https://github.com/uurtech/jdf"

  depends_on arch: :arm64
  depends_on macos: :catalina

  app "JDF Reader.app"

  # The dmg is unsigned. Strip the macOS quarantine attribute so Gatekeeper
  # does not show "JDF Reader is damaged and can't be opened" on first launch.
  postflight do
    system_command "/usr/bin/xattr",
                   args: ["-cr", "#{appdir}/JDF Reader.app"],
                   sudo: false
  end

  zap trash: [
    "~/Library/Application Support/dev.jdf.viewer",
    "~/Library/Caches/dev.jdf.viewer",
    "~/Library/Preferences/dev.jdf.viewer.plist",
    "~/Library/WebKit/dev.jdf.viewer",
  ]
end
