cask "jdf-viewer" do
  version "0.1.0"
  sha256 "b68043a514ad1725f78a90c9100cc5ddd7490a0958b6da729d8241716c1832a9"

  url "https://github.com/uurtech/jdf/releases/download/v#{version}/JDF.Viewer_#{version}_aarch64.dmg"
  name "JDF Viewer"
  desc "Viewer and editor for the JDF (JSON Document Format)"
  homepage "https://github.com/uurtech/jdf"

  depends_on arch: :arm64
  depends_on macos: ">= :catalina"

  app "JDF Viewer.app"

  postflight do
    system_command "/usr/bin/xattr",
                   args:         ["-cr", "#{appdir}/JDF Viewer.app"],
                   sudo:         false,
                   must_succeed: false
  end

  zap trash: [
    "~/Library/Application Support/dev.jdf.viewer",
    "~/Library/Caches/dev.jdf.viewer",
    "~/Library/Preferences/dev.jdf.viewer.plist",
    "~/Library/WebKit/dev.jdf.viewer",
  ]
end
