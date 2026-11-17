class JdfCli < Formula
  desc "CLI for JDF (JSON Document Format) — validate and convert PDF/JSON/MD to JDF"
  homepage "https://github.com/uurtech/jdf"
  url "https://registry.npmjs.org/@uurtech/jdf-cli/-/jdf-cli-0.2.10.tgz"
  version "0.2.10"
  sha256 "33ee132d0439b3ff7c59e5bf6e5c2a924bbe905959bc75d861ddfdc006e1a227"
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
