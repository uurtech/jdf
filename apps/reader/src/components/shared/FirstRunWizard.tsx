import { createSignal, Show, For } from "solid-js";

interface FirstRunWizardProps {
  onComplete: () => void;
}

const STEPS = [
  { title: "Hoş Geldiniz", key: "welcome" },
  { title: "Özellikler", key: "features" },
  { title: "Dosya Türleri", key: "filetypes" },
  { title: "Hazır", key: "ready" },
] as const;

export function FirstRunWizard(props: FirstRunWizardProps) {
  const [step, setStep] = createSignal(0);

  function next() {
    if (step() < STEPS.length - 1) setStep(step() + 1);
    else finish();
  }

  function finish() {
    localStorage.setItem("jdf-first-run-done", "1");
    props.onComplete();
  }

  return (
    <div class="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div class="w-[720px] h-[480px] rounded-2xl overflow-hidden shadow-2xl flex bg-slate-900 border border-slate-700/50">
        {/* Sidebar */}
        <div class="w-[200px] bg-slate-900/80 border-r border-slate-700/50 flex flex-col p-6">
          <div class="flex items-center gap-2.5 mb-8">
            <div class="w-9 h-9 rounded-xl bg-gradient-to-br from-blue-500 to-blue-700 flex items-center justify-center shadow-lg">
              <span class="text-white font-bold text-[10px]">JDF</span>
            </div>
            <span class="text-white font-semibold text-sm">JDF Reader</span>
          </div>

          <div class="flex-1 space-y-1">
            <For each={STEPS}>
              {(s, i) => (
                <div class="flex items-center gap-3 py-2">
                  <div class={`w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-bold transition-all ${
                    i() < step()
                      ? "bg-blue-600 text-white"
                      : i() === step()
                        ? "bg-blue-600 text-white ring-2 ring-blue-400/50"
                        : "bg-slate-700 text-slate-400"
                  }`}>
                    <Show when={i() < step()} fallback={<span>{i() + 1}</span>}>
                      <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M2.5 6l2.5 2.5 4.5-5" />
                      </svg>
                    </Show>
                  </div>
                  <span class={`text-xs transition-colors ${
                    i() <= step() ? "text-white" : "text-slate-500"
                  }`}>{s.title}</span>
                </div>
              )}
            </For>
          </div>

          <button onClick={finish} class="text-[11px] text-slate-500 hover:text-slate-300 transition-colors text-left">
            Atla
          </button>
        </div>

        {/* Content */}
        <div class="flex-1 flex flex-col p-8 bg-gradient-to-br from-slate-800 to-slate-900">
          <div class="flex-1">
            <Show when={step() === 0}>
              <WelcomeStep />
            </Show>
            <Show when={step() === 1}>
              <FeaturesStep />
            </Show>
            <Show when={step() === 2}>
              <FileTypesStep />
            </Show>
            <Show when={step() === 3}>
              <ReadyStep />
            </Show>
          </div>

          <div class="flex justify-end gap-3 mt-6">
            <Show when={step() > 0}>
              <button
                onClick={() => setStep(step() - 1)}
                class="px-4 py-2 text-sm text-slate-400 hover:text-white border border-slate-600 hover:border-slate-500 rounded-lg transition-colors"
              >
                Geri
              </button>
            </Show>
            <button
              onClick={next}
              class="px-5 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-500 rounded-lg transition-colors shadow-lg shadow-blue-600/20"
            >
              {step() === STEPS.length - 1 ? "Başla" : "İleri"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function WelcomeStep() {
  return (
    <div class="space-y-4">
      <h2 class="text-2xl font-bold text-white">JDF Reader'a Hoş Geldiniz</h2>
      <p class="text-slate-400 text-sm leading-relaxed">
        JDF (JSON Document Format) — yapay zeka çağı için tasarlanmış, açık kaynaklı bir döküman formatı.
        PDF'lerin aksine, JDF dosyaları düz JSON'dur: okunabilir, düzenlenebilir ve AI tarafından doğrudan işlenebilir.
      </p>
      <div class="mt-8 flex justify-center">
        <div class="w-32 h-32 rounded-3xl bg-gradient-to-br from-blue-500 to-blue-700 flex items-center justify-center shadow-2xl shadow-blue-600/30">
          <span class="text-white font-bold text-4xl tracking-tight">JDF</span>
        </div>
      </div>
    </div>
  );
}

function FeaturesStep() {
  const features = [
    { icon: "📄", title: "PDF Import", desc: "PDF dosyalarını tam sadakatle JDF'e dönüştürün" },
    { icon: "✏️", title: "Yerinde Düzenleme", desc: "Herhangi bir elemente çift tıklayarak düzenleyin" },
    { icon: "🔍", title: "Tam Metin Arama", desc: "Tüm döküman içeriğinde anında arama" },
    { icon: "📋", title: "Form Desteği", desc: "Doldurulabilir formlar: input, checkbox, select" },
  ];

  return (
    <div class="space-y-4">
      <h2 class="text-2xl font-bold text-white">Özellikler</h2>
      <p class="text-slate-400 text-sm">Güçlü özelliklerle dökümanlarınızı yönetin.</p>
      <div class="grid grid-cols-2 gap-3 mt-4">
        <For each={features}>
          {(f) => (
            <div class="bg-slate-700/40 border border-slate-600/50 rounded-xl p-4 space-y-1.5">
              <div class="text-lg">{f.icon}</div>
              <div class="text-sm font-medium text-white">{f.title}</div>
              <div class="text-[11px] text-slate-400 leading-relaxed">{f.desc}</div>
            </div>
          )}
        </For>
      </div>
    </div>
  );
}

function FileTypesStep() {
  const types = [
    { ext: ".jdf", desc: "JSON Document Format — ana format", color: "bg-blue-500" },
    { ext: ".jdfx", desc: "JDF Bundle — gömülü resimler ile", color: "bg-purple-500" },
    { ext: ".pdf", desc: "PDF Import — JDF'e dönüştürülür", color: "bg-red-500" },
    { ext: ".md", desc: "Markdown — görüntüleme ve dönüştürme", color: "bg-green-500" },
  ];

  return (
    <div class="space-y-4">
      <h2 class="text-2xl font-bold text-white">Desteklenen Dosya Türleri</h2>
      <p class="text-slate-400 text-sm">Bu dosya türlerini doğrudan açabilir ve düzenleyebilirsiniz.</p>
      <div class="space-y-2.5 mt-4">
        <For each={types}>
          {(t) => (
            <div class="flex items-center gap-4 bg-slate-700/30 border border-slate-600/40 rounded-xl px-4 py-3">
              <span class={`${t.color} text-white text-[10px] font-bold uppercase px-2.5 py-1 rounded-md`}>{t.ext}</span>
              <span class="text-sm text-slate-300">{t.desc}</span>
            </div>
          )}
        </For>
      </div>
    </div>
  );
}

function ReadyStep() {
  return (
    <div class="space-y-4">
      <h2 class="text-2xl font-bold text-white">Her Şey Hazır!</h2>
      <p class="text-slate-400 text-sm leading-relaxed">
        JDF Reader kullanıma hazır. Bir döküman açarak başlayabilirsiniz.
      </p>
      <div class="mt-6 space-y-3">
        <div class="flex items-center gap-3 text-sm text-slate-300">
          <kbd class="px-2 py-1 bg-slate-700 border border-slate-600 rounded text-[11px] font-mono">Ctrl+O</kbd>
          <span>Dosya aç</span>
        </div>
        <div class="flex items-center gap-3 text-sm text-slate-300">
          <kbd class="px-2 py-1 bg-slate-700 border border-slate-600 rounded text-[11px] font-mono">Ctrl+N</kbd>
          <span>Yeni pencere</span>
        </div>
        <div class="flex items-center gap-3 text-sm text-slate-300">
          <kbd class="px-2 py-1 bg-slate-700 border border-slate-600 rounded text-[11px] font-mono">Ctrl+D</kbd>
          <span>Koyu / açık tema</span>
        </div>
        <div class="flex items-center gap-3 text-sm text-slate-300">
          <kbd class="px-2 py-1 bg-slate-700 border border-slate-600 rounded text-[11px] font-mono">?</kbd>
          <span>Tüm kısayollar</span>
        </div>
      </div>
    </div>
  );
}
