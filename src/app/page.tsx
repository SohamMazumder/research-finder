'use client';

import { useState, useEffect, FormEvent } from 'react';
import Link from 'next/link';
import Image from 'next/image';

interface ArxivPaper {
  id: string;
  title: string;
  summary: string;
  authors: string[];
  published: string;
  link: string;
}

interface CitationPaper {
  paperId: string;
  title: string;
  abstract: string;
  authors: string[];
  year: string;
  url: string;
  venue: string;
}

interface KeywordWithWeight {
  term: string;
  weight: number;
}

export default function Page() {
  const [papers, setPapers] = useState<ArxivPaper[]>([]);
  const [citingPapers, setCitingPapers] = useState<CitationPaper[]>([]);
  const [loading, setLoading] = useState(false);
  const [citationsLoading, setCitationsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [citationsError, setCitationsError] = useState<string | null>(null);
  const [keywords, setKeywords] = useState('LLM');
  const [inputValue, setInputValue] = useState('');
  const [paperUrl, setPaperUrl] = useState('');
  const [activePaperUrl, setActivePaperUrl] = useState('');
  const [extractedTerms, setExtractedTerms] = useState<KeywordWithWeight[]>([]);
  const [searchMode, setSearchMode] = useState<'keyword' | 'citation'>('keyword');
  const [sourcePaperInfo, setSourcePaperInfo] = useState<{title: string, id: string, authors: string[], semanticScholarId?: string}|null>(null);
  const [scholarLink, setScholarLink] = useState<string | null>(null);
  const [selectedPaperId, setSelectedPaperId] = useState<string | null>(null);

  const extractKeyTerms = (text: string): KeywordWithWeight[] => {
    if (!text.trim()) return [];
    
    // Normalize text but preserve technical terms
    const normalizedText = text.toLowerCase();
    const result: KeywordWithWeight[] = [];
    
    // Domain-specific important terms for technology/ML
    const domainSpecificTerms = [
      'machine learning', 'deep learning', 'neural network', 'artificial intelligence',
      'computer vision', 'nlp', 'natural language processing', 'data science',
      'reinforcement learning', 'computer science', 'ml', 'ai', 'cv', 'robotics',
      'transformer', 'diffusion', 'generative', 'large language model', 'llm'
    ];
    
    // Check for domain-specific multi-word terms first (high weight)
    domainSpecificTerms.forEach(term => {
      if (normalizedText.includes(term)) {
        result.push({ term, weight: 10 });
      }
    });
    
    // Extract potential technical terms (acronyms, model names, etc.)
    const technicalTermRegex = /\b([A-Z]{2,}|[A-Z][a-z]+[A-Z]|[A-Za-z]+\d+|\w*[A-Z]\w*)\b/g;
    const technicalMatches = [...new Set(text.match(technicalTermRegex) || [])];
    
    // Add technical terms with high weight
    technicalMatches.forEach(term => {
      // Skip very common words that might be caught
      if (['I', 'A', 'The'].includes(term)) return;
      
      result.push({ 
        term: term.toLowerCase(), 
        weight: 8 
      });
    });
    
    // Find frequent words (could indicate importance)
    const words = normalizedText.split(/\s+/);
    const stopWords = new Set([
      'a', 'an', 'the', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 
      'with', 'by', 'about', 'as', 'of', 'from', 'am', 'is', 'are', 'was', 
      'were', 'been', 'being', 'have', 'has', 'had', 'having', 'do', 'does',
      'did', 'doing', 'i', 'my', 'me', 'we', 'our', 'us', 'you', 'your',
      'that', 'this', 'these', 'those', 'it', 'its'
    ]);
    
    // Count word frequency
    const wordFrequency: Record<string, number> = {};
    words.forEach(word => {
      if (word.length > 2 && !stopWords.has(word) && /^[a-z0-9]+$/.test(word)) {
        wordFrequency[word] = (wordFrequency[word] || 0) + 1;
      }
    });
    
    // Add frequent words with medium weight
    Object.entries(wordFrequency)
      .filter(([word, count]) => count > 1)
      .forEach(([word, count]) => {
        // Skip if we already have this term
        if (!result.some(item => item.term === word)) {
          result.push({ term: word, weight: 3 + count });
        }
      });
    
    // Add other non-frequent but potentially relevant words with low weight
    Object.keys(wordFrequency)
      .filter(word => wordFrequency[word] === 1 && word.length > 3)
      .forEach(word => {
        // Skip if we already have this term
        if (!result.some(item => item.term === word)) {
          result.push({ term: word, weight: 2 });
        }
      });
    
    // Sort by weight (highest first) and return top terms
    return result
      .sort((a, b) => b.weight - a.weight)
      .slice(0, 8);
  };

  // Extract arXiv ID from various URL formats
  const extractArxivId = (url: string): string | null => {
    // Handle direct arXiv URLs
    const arxivPatterns = [
      /arxiv\.org\/abs\/(\d+\.\d+)/i,
      /arxiv\.org\/pdf\/(\d+\.\d+)/i,
      /arxiv\.org\/abs\/([a-z\-]+\/\d+)/i,
      /arxiv\.org\/pdf\/([a-z\-]+\/\d+)/i,
      /(\d+\.\d+)/i  // Just the ID itself
    ];
    
    for (const pattern of arxivPatterns) {
      const match = url.match(pattern);
      if (match && match[1]) {
        return match[1];
      }
    }
    
    return null;
  };

  const createGoogleScholarLink = (title: string, authors: string[]): string => {
    // Create a search query for Google Scholar
    // Format: intitle:"Paper Title" author:FirstAuthorLastName
    
    // Get first author's last name if available
    let authorPart = '';
    if (authors.length > 0) {
      const firstAuthor = authors[0];
      const lastName = firstAuthor.split(' ').pop();
      if (lastName) {
        authorPart = `+author:${encodeURIComponent(lastName)}`;
      }
    }
    
    // Format title for search
    const titleQuery = `intitle:${encodeURIComponent(`"${title}"`)}`; 
    
    // Construct full query URL
    return `https://scholar.google.com/scholar?q=${titleQuery}${authorPart}`;
  };

  const fetchPaperDetails = async (arxivId: string): Promise<{title: string, id: string, authors: string[], semanticScholarId?: string} | null> => {
    try {
      const response = await fetch(`https://export.arxiv.org/api/query?id_list=${arxivId}`);
      
      if (!response.ok) {
        throw new Error('Failed to fetch paper details');
      }
      
      const data = await response.text();
      const parser = new DOMParser();
      const xmlDoc = parser.parseFromString(data, 'text/xml');
      
      const entries = xmlDoc.getElementsByTagName('entry');
      if (entries.length === 0) {
        throw new Error('Paper not found');
      }
      
      const entry = entries[0];
      const title = entry.getElementsByTagName('title')[0]?.textContent?.trim() || '';
      
      // Extract authors
      const authorElements = entry.getElementsByTagName('author');
      const authors = [];
      for (let j = 0; j < authorElements.length; j++) {
        const name = authorElements[j].getElementsByTagName('name')[0]?.textContent;
        if (name) authors.push(name);
      }
      
      // Try to find the paper in Semantic Scholar using the title and first author
      let semanticScholarId = undefined;
      try {
        if (title) {
          const semanticResponse = await fetch(`https://api.semanticscholar.org/graph/v1/paper/search?query=${encodeURIComponent(title)}&limit=1&fields=paperId`);
          if (semanticResponse.ok) {
            const semanticData = await semanticResponse.json();
            if (semanticData.data && semanticData.data.length > 0) {
              semanticScholarId = semanticData.data[0].paperId;
            }
          }
        }
      } catch (error) {
        console.error('Error fetching Semantic Scholar ID:', error);
        // Continue without the Semantic Scholar ID
      }
      
      return { title, id: arxivId, authors, semanticScholarId };
    } catch (err) {
      console.error('Error fetching paper details:', err);
      return null;
    }
  };

      const fetchCitations = async (semanticScholarId: string) => {
    try {
      setCitationsLoading(true);
      setCitationsError(null);
      
      // Fetch citations from Semantic Scholar API
      const response = await fetch(`https://api.semanticscholar.org/graph/v1/paper/${semanticScholarId}/citations?limit=10&fields=title,abstract,authors,year,url,venue`);
      
      if (!response.ok) {
        throw new Error('Failed to fetch citations');
      }
      
      const data = await response.json();
      
      // Process the citations
      if (data.data && Array.isArray(data.data)) {
        const processedCitations: CitationPaper[] = data.data
          .filter((item: any) => item.citingPaper) // Ensure the citing paper exists
          .map((item: any) => {
            const paper = item.citingPaper;
            return {
              paperId: paper.paperId,
              title: paper.title || 'Unknown Title',
              abstract: paper.abstract || 'No abstract available',
              authors: paper.authors?.map((author: any) => author.name) || [],
              year: paper.year || 'Unknown',
              url: paper.url || '',
              venue: paper.venue || 'Unknown Venue'
            };
          });
        
        setCitingPapers(processedCitations);
      } else {
        setCitingPapers([]);
      }
    } catch (err) {
      setCitationsError(err instanceof Error ? err.message : 'An error occurred fetching citations');
      console.error(err);
    } finally {
      setCitationsLoading(false);
    }
  };

  const searchGoogleScholar = async (paperUrl: string) => {
    if (!paperUrl.trim()) {
      setError("Please provide a paper URL or arXiv ID");
      return;
    }
    
    try {
      setLoading(true);
      setError(null);
      setPapers([]);
      setCitingPapers([]);
      setCitationsError(null);
      
      // Extract arXiv ID from URL
      const arxivId = extractArxivId(paperUrl);
      if (!arxivId) {
        setError("Unable to extract a valid arXiv ID from the provided URL");
        setLoading(false);
        return;
      }
      
      // Fetch the source paper details
      const paperInfo = await fetchPaperDetails(arxivId);
      if (!paperInfo) {
        setError("Unable to find paper details");
        setLoading(false);
        return;
      }
      
      setSourcePaperInfo(paperInfo);
      
      // Create Google Scholar link
      const scholarSearchUrl = createGoogleScholarLink(paperInfo.title, paperInfo.authors);
      setScholarLink(scholarSearchUrl);
      
      // Extract keywords from the paper title for displaying
      const titleKeywords = extractKeyTerms(paperInfo.title)
        .slice(0, 5)
        .map(k => ({ term: k.term, weight: 8 }));
      
      setExtractedTerms(titleKeywords);

      // Fetch citations if we have a Semantic Scholar ID
      if (paperInfo.semanticScholarId) {
        await fetchCitations(paperInfo.semanticScholarId);
      }

      // Now also fetch some related papers to display as suggestions
      const keywordTerms = titleKeywords.map(k => k.term);
      const queryStr = keywordTerms
        .map(term => `all:${term.includes(' ') ? `"${term}"` : term}`)
        .join('+OR+');
      
      const query = `search_query=${queryStr}&sortBy=submittedDate&sortOrder=descending&max_results=10`;
      console.log('Related papers query:', query);
      
      const response = await fetch(`https://export.arxiv.org/api/query?${query}`);
      
      if (!response.ok) {
        throw new Error('Failed to fetch related papers');
      }
      
      const data = await response.text();
      const parser = new DOMParser();
      const xmlDoc = parser.parseFromString(data, 'text/xml');
      
      const entries = xmlDoc.getElementsByTagName('entry');
      const parsedPapers: ArxivPaper[] = [];
      
      for (let i = 0; i < entries.length; i++) {
        const entry = entries[i];
        
        const id = entry.getElementsByTagName('id')[0]?.textContent?.split('/').pop() || '';
        const title = entry.getElementsByTagName('title')[0]?.textContent?.trim() || '';
        const summary = entry.getElementsByTagName('summary')[0]?.textContent?.trim() || '';
        const published = entry.getElementsByTagName('published')[0]?.textContent || '';
        const link = entry.getElementsByTagName('id')[0]?.textContent || '';
        
        // Skip the source paper itself
        if (id === arxivId || id.includes(arxivId)) continue;
        
        const authorElements = entry.getElementsByTagName('author');
        const authors = [];
        for (let j = 0; j < authorElements.length; j++) {
          const name = authorElements[j].getElementsByTagName('name')[0]?.textContent;
          if (name) authors.push(name);
        }
        
        parsedPapers.push({
          id,
          title,
          summary,
          authors,
          published: new Date(published).toLocaleDateString(),
          link
        });
      }
      
      setPapers(parsedPapers);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const fetchPapers = async (searchTerms: string) => {
    try {
      setLoading(true);
      setError(null);
      setScholarLink(null);
      setSourcePaperInfo(null);
      setCitingPapers([]);
      
      // Use keywords for search
      let queryTerms: string[] = [searchTerms];
      
      // Build OR query for all terms - using individual term clauses
      let queryStr = queryTerms
        .map(term => `all:${term.includes(' ') ? `"${term}"` : term}`)
        .join('+OR+');
      
      // ArXiv API query for latest papers with the specified keywords
      const query = `search_query=${queryStr}&sortBy=submittedDate&sortOrder=descending&max_results=10`;
      console.log('API query:', query);
      
      const response = await fetch(`https://export.arxiv.org/api/query?${query}`);
      
      if (!response.ok) {
        throw new Error('Failed to fetch papers');
      }
      
      const data = await response.text();
      const parser = new DOMParser();
      const xmlDoc = parser.parseFromString(data, 'text/xml');
      
      const entries = xmlDoc.getElementsByTagName('entry');
      const parsedPapers: ArxivPaper[] = [];
      
      for (let i = 0; i < entries.length; i++) {
        const entry = entries[i];
        
        const id = entry.getElementsByTagName('id')[0]?.textContent?.split('/').pop() || '';
        const title = entry.getElementsByTagName('title')[0]?.textContent?.trim() || '';
        const summary = entry.getElementsByTagName('summary')[0]?.textContent?.trim() || '';
        const published = entry.getElementsByTagName('published')[0]?.textContent || '';
        const link = entry.getElementsByTagName('id')[0]?.textContent || '';
        
        const authorElements = entry.getElementsByTagName('author');
        const authors = [];
        for (let j = 0; j < authorElements.length; j++) {
          const name = authorElements[j].getElementsByTagName('name')[0]?.textContent;
          if (name) authors.push(name);
        }
        
        parsedPapers.push({
          id,
          title,
          summary,
          authors,
          published: new Date(published).toLocaleDateString(),
          link
        });
      }
      
      setPapers(parsedPapers);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    // Initial load - search based on selected mode
    if (searchMode === 'keyword' && keywords) {
      fetchPapers(keywords);
    } else if (searchMode === 'citation' && activePaperUrl) {
      searchGoogleScholar(activePaperUrl);
    }
  }, [keywords, activePaperUrl, searchMode]);

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (searchMode === 'keyword' && inputValue.trim()) {
      setKeywords(inputValue.trim());
    } else if (searchMode === 'citation' && paperUrl.trim()) {
      setActivePaperUrl(paperUrl.trim());
      searchGoogleScholar(paperUrl.trim());
    }
  };

  const handleModeChange = (mode: 'keyword' | 'citation') => {
    setSearchMode(mode);
    setError(null);
    
    // Reset citation-specific state when switching to keyword mode
    if (mode === 'keyword') {
      setScholarLink(null);
      setSourcePaperInfo(null);
      setCitingPapers([]);
    }
  };

  // Function to handle selecting a paper to view full abstract
  const selectPaper = (paperId: string) => {
    setSelectedPaperId(selectedPaperId === paperId ? null : paperId);
  };

  return (
    <div className="min-h-screen p-8 pb-20 gap-8 sm:p-20 font-[family-name:var(--font-geist-sans)]">
      <header className="mb-8">
        <h1 className="text-3xl font-bold mb-2">Research Paper Finder</h1>
        <p className="text-gray-600 dark:text-gray-400 mb-6">
          Latest papers from arXiv.org based on your search preferences
        </p>
        
        <div className="space-y-4 mb-8">
          {/* Search Mode Toggle */}
          <div className="flex flex-col sm:flex-row sm:items-center gap-2 pb-4 border-b border-gray-200 dark:border-gray-700">
            <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Search mode:</span>
            <div className="flex items-center space-x-4">
              <label className="inline-flex items-center cursor-pointer">
                <input
                  type="radio"
                  className="form-radio h-4 w-4 text-blue-600"
                  checked={searchMode === 'keyword'}
                  onChange={() => handleModeChange('keyword')}
                />
                <span className="ml-2 text-sm text-gray-700 dark:text-gray-300">Keyword Search</span>
              </label>
              <label className="inline-flex items-center cursor-pointer">
                <input
                  type="radio"
                  className="form-radio h-4 w-4 text-blue-600"
                  checked={searchMode === 'citation'}
                  onChange={() => handleModeChange('citation')}
                />
                <span className="ml-2 text-sm text-gray-700 dark:text-gray-300">Citation Search</span>
              </label>
            </div>
          </div>
          
          {/* Keyword Search Section */}
          {searchMode === 'keyword' && (
            <div>
              <form onSubmit={handleSubmit} className="flex flex-col sm:flex-row gap-2">
                <div className="flex-grow">
                  <input
                    type="text"
                    value={inputValue}
                    onChange={(e) => setInputValue(e.target.value)}
                    placeholder="Enter keywords (e.g., LLM, machine learning)"
                    className="w-full px-4 py-2 border border-gray-300 dark:border-gray-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-800 dark:text-white"
                    aria-label="Search keywords"
                  />
                </div>
                <button
                  type="submit"
                  className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
                  disabled={loading}
                >
                  {loading ? 'Searching...' : 'Search'}
                </button>
              </form>
              
              {keywords && (
                <div className="mt-4 bg-blue-100 dark:bg-blue-900/30 px-4 py-2 rounded-lg inline-block">
                  <p className="text-sm text-blue-800 dark:text-blue-300">
                    Keywords: <span className="font-semibold">{keywords}</span>
                  </p>
                </div>
              )}
            </div>
          )}
          
          {/* Citation Search Section */}
          {searchMode === 'citation' && (
            <div>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Paper URL or arXiv ID
                  </label>
                  <div className="flex flex-col sm:flex-row gap-2">
                    <div className="flex-grow">
                      <input
                        type="text"
                        value={paperUrl}
                        onChange={(e) => setPaperUrl(e.target.value)}
                        placeholder="e.g., https://arxiv.org/abs/2303.08774 or 2303.08774"
                        className="w-full px-4 py-2 border border-gray-300 dark:border-gray-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-800 dark:text-white"
                        aria-label="Paper URL or arXiv ID"
                      />
                    </div>
                    <button
                      type="submit"
                      className="px-6 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition-colors focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2"
                      disabled={loading || citationsLoading}
                    >
                      {loading || citationsLoading ? 'Searching...' : 'Find Citations'}
                    </button>
                  </div>
                  <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                    Enter a URL to an arXiv paper or just the arXiv ID (e.g., 2303.08774)
                  </p>
                </div>
              </form>
              
              {sourcePaperInfo && (
                <div className="mt-4 p-4 bg-emerald-50 dark:bg-emerald-900/20 rounded-lg">
                  <h3 className="font-medium text-emerald-800 dark:text-emerald-300 mb-1">Source Paper:</h3>
                  <p className="text-sm">{sourcePaperInfo.title}</p>
                  {sourcePaperInfo.authors.length > 0 && (
                    <p className="text-xs text-gray-600 dark:text-gray-400 mt-1">
                      Authors: {sourcePaperInfo.authors.join(', ')}
                    </p>
                  )}
                  <p className="text-xs text-gray-600 dark:text-gray-400 mt-1">ID: {sourcePaperInfo.id}</p>
                  
                  <div className="flex flex-col sm:flex-row gap-2 mt-4">
                    {scholarLink && (
                      <a 
                        href={scholarLink}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors max-w-fit"
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                          <path d="M12 24a7 7 0 1 1 0-14 7 7 0 0 1 0 14zm0-24L0 9.5l4.838 3.94A8 8 0 0 1 12 9a8 8 0 0 1 7.162 4.44L24 9.5z"/>
                        </svg>
                        View on Google Scholar
                      </a>
                    )}
                    
                    {sourcePaperInfo.semanticScholarId && !citationsLoading && citingPapers.length === 0 && (
                      <button
                        onClick={() => fetchCitations(sourcePaperInfo.semanticScholarId!)}
                        disabled={citationsLoading}
                        className="flex items-center gap-2 px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors max-w-fit"
                      >
                        {citationsLoading ? 'Loading...' : 'Refresh Citations'}
                      </button>
                    )}
                  </div>
                  
                  {extractedTerms.length > 0 && (
                    <div className="mt-3">
                      <p className="text-xs text-gray-500 mb-1">Search terms from paper title:</p>
                      <div className="flex flex-wrap gap-1.5">
                        {extractedTerms.map((item, index) => (
                          <span 
                            key={index}
                            className="px-2 py-1 bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300 text-xs rounded"
                          >
                            {item.term}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </header>

      <main>
        {(loading || citationsLoading) && (
          <div className="flex justify-center items-center py-20">
            <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-gray-900 dark:border-white"></div>
          </div>
        )}

        {error && (
          <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 p-4 rounded-lg">
            <p className="text-red-800 dark:text-red-400">Error: {error}</p>
            <p className="mt-2">
              Please try again later or check your network connection.
            </p>
          </div>
        )}

        {citationsError && (
          <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 p-4 rounded-lg mt-4">
            <p className="text-red-800 dark:text-red-400">Error loading citations: {citationsError}</p>
          </div>
        )}

        {searchMode === 'citation' && !loading && !citationsLoading && (
          <>
            {/* Papers Citing This Paper Section */}
            {citingPapers.length > 0 && (
              <div className="mb-8">
                <h2 className="text-xl font-semibold mb-4 flex items-center gap-2">
                  <span>Papers Citing This Paper</span>
                  <span className="bg-purple-100 text-purple-800 text-xs px-2 py-0.5 rounded-full">
                    {citingPapers.length}
                  </span>
                </h2>
                <div className="border-b border-gray-200 dark:border-gray-700 mb-6"></div>
                
                <ul className="space-y-6">
                  {citingPapers.map((paper) => (
                    <li 
                      key={paper.paperId}
                      className="border border-purple-200 dark:border-purple-900/30 rounded-lg p-6 hover:bg-purple-50 dark:hover:bg-purple-900/10 transition-colors"
                    >
                      <div className="cursor-pointer" onClick={() => selectPaper(paper.paperId)}>
                        <h3 className="text-xl font-semibold mb-2">{paper.title}</h3>
                        <div className="flex flex-wrap gap-2 text-sm text-gray-600 dark:text-gray-400 mb-3">
                          <span>{paper.authors.slice(0, 3).join(', ')}{paper.authors.length > 3 ? ', et al.' : ''}</span>
                          <span>•</span>
                          <span>{paper.year}</span>
                          {paper.venue && paper.venue !== 'Unknown Venue' && (
                            <>
                              <span>•</span>
                              <span>{paper.venue}</span>
                            </>
                          )}
                        </div>
                        <p className={`text-gray-700 dark:text-gray-300 ${selectedPaperId === paper.paperId ? '' : 'line-clamp-3'}`}>
                          {paper.abstract || 'No abstract available'}
                        </p>
                        {selectedPaperId === paper.paperId && (
                          <div className="mt-4 flex space-x-3">
                            <a 
                              href={paper.url || `https://api.semanticscholar.org/paper/${paper.paperId}`} 
                              target="_blank"
                              rel="noopener noreferrer"
                              className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors inline-flex items-center gap-2"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                                <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                                <path d="M15 3h6v6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                                <path d="M10 14L21 3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                              </svg>
                              View Paper
                            </a>
                            <button 
                              onClick={(e) => {e.stopPropagation(); setSelectedPaperId(null);}}
                              className="px-4 py-2 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 rounded hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
                            >
                              Close
                            </button>
                          </div>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            
            {/* No Citations Message */}
            {!citationsLoading && citingPapers.length === 0 && sourcePaperInfo && !citationsError && (
              <div className="mb-6 p-4 bg-purple-50 dark:bg-purple-900/10 rounded-lg">
                <p className="text-sm text-purple-800 dark:text-purple-300">
                  {sourcePaperInfo.semanticScholarId 
                    ? "No citations found for this paper in Semantic Scholar's database."
                    : "This paper wasn't found in Semantic Scholar's database for citation information."}
                </p>
                <p className="text-xs text-gray-600 dark:text-gray-400 mt-2">
                  You can still check citations on Google Scholar using the button above.
                </p>
              </div>
            )}
            
            {/* Related Papers Section */}
            {papers.length > 0 && (
              <div className="mt-8">
                <h2 className="text-xl font-semibold mb-4">Related Papers</h2>
                <div className="border-b border-gray-200 dark:border-gray-700 mb-6"></div>
                
                <ul className="space-y-6">
                  {papers.map((paper) => (
                    <li 
                      key={paper.id}
                      className="border border-gray-200 dark:border-gray-800 rounded-lg p-6 hover:bg-gray-50 dark:hover:bg-gray-900/30 transition-colors"
                    >
                      <div className="cursor-pointer" onClick={() => selectPaper(paper.id)}>
                        <h3 className="text-xl font-semibold mb-2">{paper.title}</h3>
                        <p className="text-sm text-gray-600 dark:text-gray-400 mb-3">
                          {paper.authors.join(', ')} • Published: {paper.published}
                        </p>
                        <p className={`text-gray-700 dark:text-gray-300 ${selectedPaperId === paper.id ? '' : 'line-clamp-3'}`}>
                          {paper.summary}
                        </p>
                        {selectedPaperId === paper.id && (
                          <div className="mt-4 flex space-x-3">
                            <a 
                              href={paper.link} 
                              target="_blank"
                              rel="noopener noreferrer"
                              className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors inline-flex items-center gap-2"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                                <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                                <path d="M15 3h6v6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                                <path d="M10 14L21 3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                              </svg>
                              View on arXiv
                            </a>
                            <button 
                              onClick={(e) => {e.stopPropagation(); setSelectedPaperId(null);}}
                              className="px-4 py-2 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 rounded hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
                            >
                              Close
                            </button>
                          </div>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}

        {/* Keyword Search Results */}
        {searchMode === 'keyword' && !loading && !error && (
          <>
            {papers.length === 0 ? (
              <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 p-4 rounded-lg">
                <p className="text-yellow-800 dark:text-yellow-400">
                  No papers found for "{keywords}". Try different keywords.
                </p>
              </div>
            ) : (
              <ul className="space-y-6">
                {papers.map((paper) => (
                  <li 
                    key={paper.id}
                    className="border border-gray-200 dark:border-gray-800 rounded-lg p-6 hover:bg-gray-50 dark:hover:bg-gray-900/30 transition-colors"
                  >
                    <div className="cursor-pointer" onClick={() => selectPaper(paper.id)}>
                      <h2 className="text-xl font-semibold mb-2">{paper.title}</h2>
                      <p className="text-sm text-gray-600 dark:text-gray-400 mb-3">
                        {paper.authors.join(', ')} • Published: {paper.published}
                      </p>
                      <p className={`text-gray-700 dark:text-gray-300 ${selectedPaperId === paper.id ? '' : 'line-clamp-3'}`}>
                        {paper.summary}
                      </p>
                      {selectedPaperId === paper.id && (
                        <div className="mt-4 flex space-x-3">
                          <a 
                            href={paper.link} 
                            target="_blank"
                            rel="noopener noreferrer"
                            className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors inline-flex items-center gap-2"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                              <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                              <path d="M15 3h6v6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                              <path d="M10 14L21 3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                            </svg>
                            View on arXiv
                          </a>
                          <button 
                            onClick={(e) => {e.stopPropagation(); setSelectedPaperId(null);}}
                            className="px-4 py-2 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 rounded hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
                          >
                            Close
                          </button>
                        </div>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </main>

      <footer className="mt-12 pt-6 border-t border-gray-200 dark:border-gray-800 flex justify-center">
        <Link 
          href="/"
          className="flex items-center gap-2 hover:underline hover:underline-offset-4"
        >
          <Image
            src="/globe.svg"
            alt="Home icon"
            width={16}
            height={16}
          />
          Back to Home
        </Link>
      </footer>
    </div>
  );
} 