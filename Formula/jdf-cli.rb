class JdfCli < Formula
  desc "CLI for JDF (JSON Document Format) — validate and convert PDF/JSON/MD to JDF"
  homepage "https://github.com/uurtech/jdf"
  url "https://registry.npmjs.org/@uurtech/jdf-cli/-/jdf-cli-0.1.22.tgz"
  version "0.1.22"
  sha256 "ecec2abce13fb6fbe72a9c1d5c35b1870f3885ac4cee7d0403cb26c93703c356"
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
