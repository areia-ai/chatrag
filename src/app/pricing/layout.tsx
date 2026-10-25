'use client';

export default function PricingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      <style jsx global>{`
        .main-content:has(.pricing-page-wrapper) {
          overflow-y: auto !important;
          overflow-x: hidden !important;
          height: 100vh !important;
        }
        
        .main-content:has(.pricing-page-wrapper)::-webkit-scrollbar {
          width: 10px;
        }
        
        .main-content:has(.pricing-page-wrapper)::-webkit-scrollbar-track {
          background: transparent;
        }
        
        .main-content:has(.pricing-page-wrapper)::-webkit-scrollbar-thumb {
          background: #888;
          border-radius: 5px;
        }
        
        .main-content:has(.pricing-page-wrapper)::-webkit-scrollbar-thumb:hover {
          background: #555;
        }
        
        html.dark .main-content:has(.pricing-page-wrapper)::-webkit-scrollbar-thumb {
          background: #555;
        }
        
        html.dark .main-content:has(.pricing-page-wrapper)::-webkit-scrollbar-thumb:hover {
          background: #777;
        }
      `}</style>
      <div className="pricing-page-wrapper w-full">
        {children}
      </div>
    </>
  );
}
