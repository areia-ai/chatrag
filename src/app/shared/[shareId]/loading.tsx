export default function SharedChatLoading() {
  return (
    <div className="flex flex-col min-h-screen bg-[#FFFAF5] dark:bg-[#1A1A1A]">
      <header className="sticky top-0 z-50 w-full border-b border-[#FFE0D0] dark:border-[#2F2F2F] bg-[#FFFAF5] dark:bg-[#1A1A1A]">
        <div className="container flex h-16 items-center px-4">
          <div className="flex items-center gap-2">
            <div className="h-8 w-48 animate-pulse rounded-md bg-[#FFE0D0] dark:bg-[#2F2F2F]" />
            <div className="h-6 w-32 animate-pulse rounded-md bg-[#FFE0D0] dark:bg-[#2F2F2F]" />
          </div>
        </div>
      </header>

      <main className="flex-1 overflow-hidden">
        <div className="container h-full py-6">
          <div className="h-full overflow-y-auto px-4">
            <div className="space-y-4 pb-20">
              {[...Array(3)].map((_, i) => (
                <div
                  key={i}
                  className="flex flex-col space-y-2 p-4 rounded-lg bg-[#FFF0E8] dark:bg-[#2F2F2F]"
                >
                  <div className="h-4 w-24 animate-pulse rounded-md bg-[#FFE0D0] dark:bg-[#424242]" />
                  <div className="space-y-2">
                    <div className="h-4 w-full animate-pulse rounded-md bg-[#FFE0D0] dark:bg-[#424242]" />
                    <div className="h-4 w-3/4 animate-pulse rounded-md bg-[#FFE0D0] dark:bg-[#424242]" />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </main>

      <footer className="border-t border-[#FFE0D0] dark:border-[#2F2F2F] bg-[#FFFAF5] dark:bg-[#1A1A1A]">
        <div className="container flex h-16 items-center px-4">
          <div className="h-4 w-64 animate-pulse rounded-md bg-[#FFE0D0] dark:bg-[#2F2F2F]" />
        </div>
      </footer>
    </div>
  );
} 