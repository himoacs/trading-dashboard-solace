import React from 'react';
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ChevronRight, ArrowDownWideNarrow, Network } from "lucide-react";
import { EXCHANGES } from '@/lib/exchangeUtils';

interface ActiveWildcardsProps {
  subscribedTopics: string[];
}

export function ActiveWildcards({ subscribedTopics }: ActiveWildcardsProps) {
  // Filter topics to get only exchange wildcards
  const activeWildcards = subscribedTopics.filter(topic => 
    topic.startsWith('market-data/EQ/') && topic.endsWith('/>')
  );
  
  // Convert wildcards to more readable form
  const wildcardInfo = activeWildcards.map(topic => {
    const parts = topic.split('/');
    if (parts.length === 5 && parts[4] === '>') {
      const country = parts[2];
      const exchange = parts[3];
      
      // Find exchange details from our config
      const exchangeDetails = EXCHANGES.find(e => e.id === exchange);
      
      // Safely access stocks array length
      let stockCount = 0;
      if (exchangeDetails && exchangeDetails.stocks) {
        stockCount = exchangeDetails.stocks.length;
      }
      
      return {
        topic,
        country,
        exchange,
        name: exchangeDetails?.name || exchange,
        stockCount
      };
    }
    return { topic, country: 'Unknown', exchange: 'Unknown', name: 'Unknown Exchange', stockCount: 0 };
  });

  if (wildcardInfo.length === 0) {
    return null;
  }
  
  return (
    <Card className="mb-4 border-green-600/20 bg-green-50/10">
      <CardHeader className="pb-2">
        <CardTitle className="text-md flex items-center">
          <Network className="w-4 h-4 mr-2 text-green-600" />
          <span>Active Exchange Wildcards</span>
        </CardTitle>
        <CardDescription>
          Efficiently subscribing to entire exchanges
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-2">
          {wildcardInfo.map((info, index) => (
            <div key={index} className="flex items-center justify-between p-2 rounded bg-green-100/20 border border-green-200/30">
              <div className="flex items-center">
                <ChevronRight className="w-4 h-4 mr-2 text-green-600" />
                <span className="font-medium">{info.name}</span>
                <span className="ml-2 text-xs text-green-800/70">({info.exchange}/{info.country})</span>
              </div>
              <div className="flex items-center">
                <Badge variant="outline" className="bg-green-100/50 text-green-900 border-green-300">
                  <ArrowDownWideNarrow className="w-3 h-3 mr-1" />
                  {info.stockCount} stocks
                </Badge>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

export default ActiveWildcards;