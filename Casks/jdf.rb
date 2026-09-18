cask "jdf" do
  version "0.2.3"
  sha256 "2c214bc0b608510f6a6cb35495c243e50aca3eae78c676508be44f63c74b92aa"

  url "https://github.com/uurtech/jdf/releases/download/v#{version}/JDF.Reader_#{version}_aarch64.dmg"
  name "JDF Reader"
  desc "Viewer and editor for the JDF (JSON Document Format)"
  homepage "https://github.com/uurtech/jdf"

  depends_on arch: :arm64

  app "JDF Reader.app"

  # The dmg is signed with a Developer ID cert and notarized by Apple, so it
  # passes Gatekeeper without any quarantine-stripping workaround.

  zap trash: [
    "~/Library/Application Support/dev.jdf.viewer",
    "~/Library/Caches/dev.jdf.viewer",
    "~/Library/Preferences/dev.jdf.viewer.plist",
    "~/Library/WebKit/dev.jdf.viewer",
  ]
end
