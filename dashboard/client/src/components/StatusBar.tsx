interface StatusBarProps {
  marketDataActive: boolean;
  twitterFeedActive: boolean;
  signalDataActive: boolean;
  newsFeedActive?: boolean;
  economicDataActive?: boolean;
  lastUpdated: Date | null;
  solaceConnected?: boolean;
}

export default function StatusBar({
  marketDataActive,
  twitterFeedActive,
  signalDataActive,
  newsFeedActive = false,
  economicDataActive = false,
  lastUpdated,
  solaceConnected = false
}: StatusBarProps) {
  return (
    <footer className="bg-black/95 backdrop-blur-sm border-t border-green-800 px-6 text-xs text-gray-300 h-10 flex items-center flex-shrink-0 fixed bottom-0 left-0 right-0 z-50 shadow-lg shadow-black/30">
      <div className="w-full flex items-center justify-between">
        <div className="flex items-center space-x-6">
          <div className="flex items-center">
            <span className={`w-2 h-2 rounded-full ${marketDataActive ? 'bg-green-500 shadow-sm shadow-green-500/50' : 'bg-gray-600'} mr-2 ${marketDataActive ? 'animate-pulse' : ''}`}></span>
            <span className={marketDataActive ? 'text-green-300' : 'text-gray-400'}>Market Data</span>
          </div>
          <div className="flex items-center">
            <span className={`w-2 h-2 rounded-full ${twitterFeedActive ? 'bg-blue-500 shadow-sm shadow-blue-500/50' : 'bg-gray-600'} mr-2 ${twitterFeedActive ? 'animate-pulse' : ''}`}></span>
            <span className={twitterFeedActive ? 'text-blue-300' : 'text-gray-400'}>Twitter Feed</span>
          </div>
        </div>
        <div className="text-right flex items-center">
          <span className="mr-2">Last updated:</span> 
          <span className={`font-mono ${lastUpdated ? 'text-green-300' : 'text-gray-500'}`}>
            {lastUpdated ? lastUpdated.toLocaleTimeString() : 'Never'}
          </span>
        </div>
      </div>
    </footer>
  );
}
