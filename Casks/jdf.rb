cask "jdf" do
  version "0.2.8"
  sha256 "8edfdb5958ea970c7d222fcf21dd4afa3b8e7f4d28df9a336afbd0ce7f887b02"

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
