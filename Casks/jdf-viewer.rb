cask "jdf-viewer" do
  version "0.1.0"
  sha256 "76f66ecedb7a5af740fb6282c79dfc3146cf763249e0bcd216b07282eec32427"

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
