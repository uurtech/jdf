cask "jdf" do
  version "0.2.6"
  sha256 "0c3e11cb1909ad7896777a7d712cc1dd278725edf1cbaa1aa7d73ebb061f34d4"

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
