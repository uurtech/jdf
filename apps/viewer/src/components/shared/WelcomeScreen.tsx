interface WelcomeScreenProps {
  onOpen: () => void;
}

export function WelcomeScreen(props: WelcomeScreenProps) {
  return (
    <div class="flex-1 flex items-center justify-center bg-gray-50">
      <div class="text-center space-y-6">
        <div class="w-16 h-16 rounded-2xl bg-blue-600 flex items-center justify-center mx-auto shadow-lg">
          <span class="text-white font-bold text-xl">JDF</span>
        </div>
        <div>
          <h1 class="text-xl font-semibold text-gray-800">JDF Viewer</h1>
          <p class="text-sm text-gray-500 mt-1">Open a document to get started</p>
        </div>
        <button
          onClick={props.onOpen}
          class="px-6 py-2.5 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors shadow-sm"
        >
          Open Document
        </button>
        <div class="pt-4 space-y-1.5">
          <p class="text-xs text-gray-400">
            <kbd class="px-1.5 py-0.5 bg-gray-200 rounded text-gray-500 font-mono">Cmd+O</kbd> Open file
          </p>
          <p class="text-xs text-gray-400">
            <kbd class="px-1.5 py-0.5 bg-gray-200 rounded text-gray-500 font-mono">Cmd+F</kbd> Search
          </p>
          <p class="text-xs text-gray-400">
            <kbd class="px-1.5 py-0.5 bg-gray-200 rounded text-gray-500 font-mono">Cmd++/-</kbd> Zoom
          </p>
        </div>
      </div>
    </div>
  );
}
