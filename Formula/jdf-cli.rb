class JdfCli < Formula
  desc "CLI for JDF (JSON Document Format) — validate and convert PDF/JSON/MD to JDF"
  homepage "https://github.com/uurtech/jdf"
  url "https://registry.npmjs.org/@uurtech/jdf-cli/-/jdf-cli-0.2.6.tgz"
  version "0.2.6"
  sha256 "c8255cef2b71e0d2ab408fd238aa8edd83fba982540ff10c7a0458a4aa628486"
  license "MIT"

  depends_on "node"

  def install
    system "npm", "install", *std_npm_args
    bin.install_symlink Dir["#{libexec}/bin/*"]
  end

  test do
    # `jdf --help` with no command exits 1 by design, so allow a non-zero exit
    # and assert on the banner text instead.
    assert_match "JSON Document Format CLI", shell_output("#{bin}/jdf --help", 1)
  end
end
