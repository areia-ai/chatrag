'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Loader2, Globe, Check, AlertCircle } from 'lucide-react';

interface UrlScraperProps {
    organizationId?: string | null;
    onComplete?: () => void;
}

export function UrlScraper({ organizationId, onComplete }: UrlScraperProps) {
    const [url, setUrl] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState<{ url: string; title?: string } | null>(null);

    const handleScrape = async () => {
        if (!url.trim()) {
            setError('Please enter a URL');
            return;
        }

        // Basic URL validation
        try {
            new URL(url);
        } catch {
            setError('Please enter a valid URL (including http:// or https://)');
            return;
        }

        setIsLoading(true);
        setError(null);
        setSuccess(null);

        try {
            const response = await fetch('/api/scrapers/scrape', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    url,
                    organizationId,
                    outputFormat: 'html', // Default to HTML for best table extraction
                }),
            });

            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.error || data.details || 'Failed to scrape URL');
            }

            setSuccess({ url: data.url, title: data.title });
            setUrl(''); // Clear input on success

            // Call onComplete callback if provided
            if (onComplete) {
                setTimeout(onComplete, 1500); // Small delay to show success message
            }
        } catch (err) {
            console.error('Scraping error:', err);
            setError(err instanceof Error ? err.message : 'Failed to scrape URL');
        } finally {
            setIsLoading(false);
        }
    };

    const handleKeyPress = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Enter' && !isLoading) {
            handleScrape();
        }
    };

    return (
        <Card className="border-[#FFE0D0] dark:border-[#2A2A2A] bg-[#FFF0E8] dark:bg-[#1A1A1A]">
            <CardHeader>
                <CardTitle className="flex items-center gap-2 text-gray-900 dark:text-white">
                    <Globe className="h-5 w-5 text-[#FF6417]" />
                    Scrape Web Page
                </CardTitle>
                <CardDescription className="text-gray-600 dark:text-gray-400">
                    Import content from any web page into your knowledge base
                </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
                <div className="space-y-2">
                    <label htmlFor="url-input" className="text-sm font-medium text-gray-900 dark:text-white">
                        URL
                    </label>
                    <div className="flex gap-2">
                        <Input
                            id="url-input"
                            type="url"
                            placeholder="https://example.com/article"
                            value={url}
                            onChange={(e) => setUrl(e.target.value)}
                            onKeyPress={handleKeyPress}
                            disabled={isLoading}
                            className="flex-1 bg-white dark:bg-[#212121] border-[#FFE0D0] dark:border-[#2A2A2A] text-gray-900 dark:text-white"
                        />
                        <Button
                            onClick={handleScrape}
                            disabled={isLoading || !url.trim()}
                            className="bg-[#FF6417] hover:bg-[#E05A15] text-white dark:bg-[#212121] dark:hover:bg-[#1A1A1A] dark:border dark:border-[#3A3A3A]"
                        >
                            {isLoading ? (
                                <>
                                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                    Scraping...
                                </>
                            ) : (
                                'Scrape'
                            )}
                        </Button>
                    </div>
                </div>

                {error && (
                    <div className="flex items-start gap-2 rounded-lg border border-red-500 bg-red-50 dark:bg-red-950/20 p-3">
                        <AlertCircle className="h-5 w-5 text-red-600 dark:text-red-400 flex-shrink-0 mt-0.5" />
                        <p className="text-sm text-red-900 dark:text-red-100">{error}</p>
                    </div>
                )}

                {success && (
                    <div className="flex items-start gap-2 rounded-lg border border-green-500 bg-green-50 dark:bg-green-950/20 p-3">
                        <Check className="h-5 w-5 text-green-600 dark:text-green-400 flex-shrink-0 mt-0.5" />
                        <div className="flex-1">
                            <p className="text-sm text-green-900 dark:text-green-100">
                                Successfully scraped and added to your knowledge base
                            </p>
                            {success.title && (
                                <p className="text-sm font-medium text-green-900 dark:text-green-100 mt-1">
                                    {success.title}
                                </p>
                            )}
                        </div>
                    </div>
                )}

                <div className="text-xs text-gray-600 dark:text-gray-400 bg-[#FFF0E8] dark:bg-[#1A1A1A] rounded-lg p-3 border border-[#FFE0D0] dark:border-[#2A2A2A]">
                    <p className="font-medium mb-2">This will:</p>
                    <ul className="ml-4 space-y-1 list-disc">
                        <li>Extract the main content from the page</li>
                        <li>Parse tables and formatted text</li>
                        <li>Create searchable chunks</li>
                        <li>Make it available in your AI chat</li>
                    </ul>
                </div>
            </CardContent>
        </Card>
    );
}
