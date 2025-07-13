'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import VideoPlayer from './VideoPlayer';
import AuthenticatedImage from './AuthenticatedImage';
import apiClient from '@/lib/api-client';

interface MediaItem {
  id: string;
  name: string;
  type: 'image' | 'video';
  favorite: boolean;
  thumbnail_url: string;
  preview_url?: string;
  metadata: {
    width: number;
    height: number;
    duration?: number;
    size_bytes: number;
  };
}

export default function MediaGallery() {
  const [media, setMedia] = useState<MediaItem[]>([]);
  const [selectedMedia, setSelectedMedia] = useState<MediaItem | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [mediaType, setMediaType] = useState<'all' | 'image' | 'video' | 'favorites'>('all');
  const [totalCounts, setTotalCounts] = useState({ all: 0, image: 0, video: 0, favorites: 0 });
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const observerRef = useRef<IntersectionObserver | null>(null);
  const loadMoreRef = useRef<HTMLDivElement>(null);
  const modalRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [touchStart, setTouchStart] = useState<{ x: number; y: number } | null>(null);
  const [touchEnd, setTouchEnd] = useState<{ x: number; y: number } | null>(null);
  const [pendingNavigation, setPendingNavigation] = useState<{ direction: 'next', fromIndex: number } | null>(null);

  const fetchMedia = useCallback(async (pageNum: number = 1, append: boolean = false) => {
    try {
      if (pageNum === 1) {
        setIsLoading(true);
      } else {
        setIsLoadingMore(true);
      }
      
      const typeParam = mediaType === 'all' ? '' : `&type=${mediaType}`;
      const response = await apiClient.get(`/api/media/library?page=${pageNum}&limit=20&sort=name&order=asc${typeParam}`);
      const newMedia = response.data.data;
      
      // Debug pagination info
      console.log(`Fetched page ${pageNum}:`, {
        itemsReceived: newMedia.length,
        totalItems: response.data.pagination.total,
        totalPages: response.data.pagination.pages,
        currentPage: response.data.pagination.page
      });
      
      if (append) {
        // Filter out duplicates using current state
        setMedia(prev => {
          const currentIds = new Set(prev.map(item => item.id));
          const uniqueNewMedia = newMedia.filter((item: MediaItem) => !currentIds.has(item.id));
          
          // Log duplicate detection stats
          const duplicateCount = newMedia.length - uniqueNewMedia.length;
          if (duplicateCount > 0) {
            console.log(`Filtered out ${duplicateCount} duplicate items from page ${pageNum}`);
          }
          
          return uniqueNewMedia.length > 0 ? [...prev, ...uniqueNewMedia] : prev;
        });
      } else {
        // Fresh load - reset everything
        setMedia(newMedia);
      }
      
      // Always check if there are more pages based on server response
      setHasMore(pageNum < response.data.pagination.pages);
      
      // Update total count for current type
      if (pageNum === 1) {
        setTotalCounts(prev => ({
          ...prev,
          [mediaType]: response.data.pagination.total
        }));
      }
      
      setError(null);
    } catch (error) {
      console.error('Failed to fetch media:', error);
      setError('Failed to load media library');
    } finally {
      setIsLoading(false);
      setIsLoadingMore(false);
    }
  }, [mediaType]);

  useEffect(() => {
    fetchMedia(1, false);
  }, [fetchMedia]);

  // Fetch counts for all media types on mount
  useEffect(() => {
    const fetchAllCounts = async () => {
      try {
        // Fetch counts for each type
        const [allRes, imageRes, videoRes, favRes] = await Promise.all([
          apiClient.get('/api/media/library?page=1&limit=1'),
          apiClient.get('/api/media/library?page=1&limit=1&type=image'),
          apiClient.get('/api/media/library?page=1&limit=1&type=video'),
          apiClient.get('/api/media/library?page=1&limit=1&type=favorites')
        ]);
        
        setTotalCounts({
          all: allRes.data.pagination.total,
          image: imageRes.data.pagination.total,
          video: videoRes.data.pagination.total,
          favorites: favRes.data.pagination.total
        });
      } catch (error) {
        console.error('Failed to fetch media counts:', error);
      }
    };
    
    fetchAllCounts();
  }, []);

  // Refresh mechanism to detect new files
  const refreshMedia = useCallback(async () => {
    setPage(1);
    
    // Refresh counts for all types
    try {
      const [allRes, imageRes, videoRes, favRes] = await Promise.all([
        apiClient.get('/api/media/library?page=1&limit=1'),
        apiClient.get('/api/media/library?page=1&limit=1&type=image'),
        apiClient.get('/api/media/library?page=1&limit=1&type=video'),
        apiClient.get('/api/media/library?page=1&limit=1&type=favorites')
      ]);
      
      setTotalCounts({
        all: allRes.data.pagination.total,
        image: imageRes.data.pagination.total,
        video: videoRes.data.pagination.total,
        favorites: favRes.data.pagination.total
      });
    } catch (error) {
      console.error('Failed to refresh media counts:', error);
    }
    
    await fetchMedia(1, false);
  }, [fetchMedia]);

  // Handle media type change
  const handleMediaTypeChange = useCallback((type: 'all' | 'image' | 'video' | 'favorites') => {
    if (type !== mediaType) {
      setMediaType(type);
      setPage(1);
      setMedia([]);
      setHasMore(true);
      setIsDropdownOpen(false);
    }
  }, [mediaType]);

  // Handle swipe up to load more content
  const handleSwipeUpForMore = useCallback(() => {
    if (hasMore && !isLoadingMore) {
      const nextPage = page + 1;
      setPage(nextPage);
      fetchMedia(nextPage, true);
    }
  }, [hasMore, isLoadingMore, page, fetchMedia]);

  // Check if we need to load more after initial render
  useEffect(() => {
    if (!isLoading && media.length > 0 && hasMore) {
      // Small delay to let the DOM settle
      setTimeout(() => {
        const scrollHeight = document.documentElement.scrollHeight;
        const viewportHeight = window.innerHeight;
        
        // If content doesn't fill the viewport, trigger load more
        if (scrollHeight <= viewportHeight + 100) {
          console.log('Initial content does not fill viewport, loading more...');
          const isTouchDevice = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
          if (!isTouchDevice) {
            handleSwipeUpForMore();
          }
        }
      }, 500);
    }
  }, [isLoading, media.length, hasMore, handleSwipeUpForMore]);

  // Handle pending navigation after new media is loaded
  useEffect(() => {
    if (pendingNavigation && !isLoadingMore) {
      const { fromIndex } = pendingNavigation;
      // Navigate to the next item after the one we were on
      const nextIndex = fromIndex + 1;
      if (nextIndex < media.length) {
        setSelectedMedia(media[nextIndex]);
      } else {
        // Fallback to wrap around if somehow we still don't have more items
        setSelectedMedia(media[0]);
      }
      setPendingNavigation(null);
    }
  }, [media, pendingNavigation, isLoadingMore]);

  // Global touch handling for swipe up to load more (mobile only)
  useEffect(() => {
    // Only add touch listeners on mobile devices
    const isTouchDevice = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
    if (!isTouchDevice) return;

    let startY = 0;
    let startTime = 0;

    const handleTouchStart = (e: TouchEvent) => {
      startY = e.touches[0].clientY;
      startTime = Date.now();
    };

    const handleTouchEnd = (e: TouchEvent) => {
      if (selectedMedia) return; // Don't handle if modal is open
      
      const endY = e.changedTouches[0].clientY;
      const deltaY = startY - endY;
      const deltaTime = Date.now() - startTime;
      const velocity = Math.abs(deltaY) / deltaTime;
      
      // Check if user is at bottom of page
      const isAtBottom = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 100;
      
      // Swipe up gesture: deltaY > 0, sufficient distance, good velocity, at bottom
      if (deltaY > 40 && velocity > 0.2 && isAtBottom && hasMore && !isLoadingMore) {
        // Add haptic feedback on supported devices
        if ('vibrate' in navigator) {
          navigator.vibrate(50);
        }
        handleSwipeUpForMore();
      }
    };

    document.addEventListener('touchstart', handleTouchStart, { passive: true });
    document.addEventListener('touchend', handleTouchEnd, { passive: true });

    return () => {
      document.removeEventListener('touchstart', handleTouchStart);
      document.removeEventListener('touchend', handleTouchEnd);
    };
  }, [selectedMedia, handleSwipeUpForMore, hasMore, isLoadingMore]);

  // Intersection observer for desktop scroll only
  useEffect(() => {
    // Check if it's a touch device (mobile/tablet)
    const isTouchDevice = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
    
    // Skip if on mobile, no element to observe, or currently loading
    if (isTouchDevice || isLoadingMore) return;

    // Small delay to ensure DOM is ready and initial content is loaded
    const timer = setTimeout(() => {
      if (!loadMoreRef.current || !hasMore) return;

      if (observerRef.current) {
        observerRef.current.disconnect();
      }

      observerRef.current = new IntersectionObserver(
        (entries) => {
          if (entries[0].isIntersecting && hasMore && !isLoadingMore) {
            // Double-check we're actually near the bottom
            const scrolledToBottom = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 300;
            if (scrolledToBottom) {
              console.log('Infinite scroll triggered - loading page', page + 1);
              const nextPage = page + 1;
              setPage(nextPage);
              fetchMedia(nextPage, true);
            }
          }
        },
        { 
          threshold: 0.01,  // Trigger when 1% visible
          rootMargin: '100px'  // Start loading 100px before reaching the element
        }
      );

      if (loadMoreRef.current) {
        observerRef.current.observe(loadMoreRef.current);
      }
    }, 100);

    return () => {
      clearTimeout(timer);
      if (observerRef.current) {
        observerRef.current.disconnect();
      }
    };
  }, [hasMore, isLoadingMore, page, fetchMedia]);

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const formatFileSize = (bytes: number) => {
    const mb = bytes / (1024 * 1024);
    return `${mb.toFixed(1)} MB`;
  };

  const toggleFavorite = async (mediaId: string) => {
    try {
      const response = await apiClient.put(`/api/media/${mediaId}/favorite`);
      
      // Update the media item in the list
      setMedia(prevMedia => 
        prevMedia.map(item => 
          item.id === mediaId ? { ...item, favorite: response.data.favorite } : item
        )
      );
      
      // Update selected media if it's the same
      if (selectedMedia?.id === mediaId) {
        setSelectedMedia(prev => prev ? { ...prev, favorite: response.data.favorite } : null);
      }
      
      // Update counts if we're in favorites view
      if (mediaType === 'favorites') {
        await refreshMedia();
      }
    } catch (error) {
      console.error('Failed to toggle favorite:', error);
    }
  };


  const getCurrentMediaIndex = useCallback(() => {
    if (!selectedMedia) return -1;
    return media.findIndex(item => item.id === selectedMedia.id);
  }, [selectedMedia, media]);

  const navigateToMedia = useCallback(async (direction: 'prev' | 'next') => {
    const currentIndex = getCurrentMediaIndex();
    if (currentIndex === -1) return;

    if (direction === 'prev') {
      const newIndex = currentIndex === 0 ? media.length - 1 : currentIndex - 1;
      setSelectedMedia(media[newIndex]);
    } else {
      // Going next
      if (currentIndex === media.length - 1) {
        // At the last item
        if (hasMore && !isLoadingMore) {
          // Load next batch first, then navigate
          setPendingNavigation({ direction: 'next', fromIndex: currentIndex });
          const nextPage = page + 1;
          setPage(nextPage);
          await fetchMedia(nextPage, true);
        } else {
          // No more content, wrap to first item
          setSelectedMedia(media[0]);
        }
      } else {
        // Normal navigation to next item
        setSelectedMedia(media[currentIndex + 1]);
      }
    }
  }, [getCurrentMediaIndex, media, hasMore, isLoadingMore, page, fetchMedia]);

  const handleTouchStart = (e: React.TouchEvent) => {
    setTouchStart({
      x: e.touches[0].clientX,
      y: e.touches[0].clientY
    });
    setTouchEnd(null);
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (!touchStart) return;
    setTouchEnd({
      x: e.touches[0].clientX,
      y: e.touches[0].clientY
    });
  };

  const handleTouchEnd = () => {
    if (!touchStart || !touchEnd) {
      return;
    }

    const deltaX = touchStart.x - touchEnd.x;
    const deltaY = touchStart.y - touchEnd.y;
    const minSwipeDistance = 50;

    // Vertical swipes (prioritize over horizontal)
    if (Math.abs(deltaY) > Math.abs(deltaX) && Math.abs(deltaY) > minSwipeDistance) {
      if (deltaY < 0) {
        // Swipe down - close modal
        setSelectedMedia(null);
      }
      // Swipe up in modal doesn't do anything special
    } else if (Math.abs(deltaX) > minSwipeDistance) {
      // Horizontal swipes for navigation
      if (deltaX > 0) {
        navigateToMedia('next');
      } else {
        navigateToMedia('prev');
      }
    }

    setTouchStart(null);
    setTouchEnd(null);
  };

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (!selectedMedia) return;

    switch (e.key) {
      case 'Escape':
        setSelectedMedia(null);
        break;
      case 'ArrowLeft':
        navigateToMedia('prev');
        break;
      case 'ArrowRight':
        navigateToMedia('next');
        break;
    }
  }, [selectedMedia, navigateToMedia]);

  useEffect(() => {
    if (selectedMedia) {
      document.addEventListener('keydown', handleKeyDown);
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = 'unset';
    }

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = 'unset';
    };
  }, [selectedMedia, handleKeyDown]);

  // Handle click outside dropdown
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsDropdownOpen(false);
      }
    };

    if (isDropdownOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isDropdownOpen]);

  if (isLoading && media.length === 0) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-white">Loading media library...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-red-500">{error}</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      {/* Sticky header with dropdown */}
      <div className="sticky top-0 z-40 bg-gray-900/95 backdrop-blur-md border-b border-gray-800">
        <div className="container mx-auto px-4 py-3">
          <div className="flex items-center justify-between">
            {/* Dropdown Menu */}
            <div className="relative" ref={dropdownRef}>
              <button
                onClick={() => setIsDropdownOpen(!isDropdownOpen)}
                className="flex items-center space-x-2 px-4 py-2.5 bg-gray-800/50 hover:bg-gray-700/50 rounded-lg transition-all duration-200 group"
              >
                <svg className="w-5 h-5 text-gray-400 group-hover:text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                </svg>
                <span className="text-white font-medium">
                  {mediaType === 'all' ? 'All Media' : 
                   mediaType === 'image' ? 'Images' : 
                   mediaType === 'video' ? 'Videos' : 'Favorites'}
                </span>
                <span className="inline-flex items-center justify-center min-w-[1.5rem] px-1.5 py-0.5 text-xs font-bold rounded-full bg-gray-600 text-gray-300">
                  {totalCounts[mediaType].toLocaleString()}
                </span>
                <svg className={`w-4 h-4 text-gray-400 transition-transform duration-200 ${isDropdownOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>

              {/* Dropdown Options */}
              {isDropdownOpen && (
                <div className="absolute top-full left-0 mt-2 w-64 bg-gray-800 border border-gray-700 rounded-lg shadow-lg overflow-hidden">
                  <button
                    onClick={() => handleMediaTypeChange('all')}
                    className={`w-full flex items-center justify-between px-4 py-3 hover:bg-gray-700 transition-colors ${
                      mediaType === 'all' ? 'bg-gray-700' : ''
                    }`}
                  >
                    <div className="flex items-center space-x-3">
                      <svg className="w-5 h-5 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                      </svg>
                      <span className="text-white font-medium">All Media</span>
                    </div>
                    <span className="inline-flex items-center justify-center min-w-[1.5rem] px-1.5 py-0.5 text-xs font-bold rounded-full bg-gray-600 text-gray-300">
                      {totalCounts.all.toLocaleString()}
                    </span>
                  </button>
                  
                  <button
                    onClick={() => handleMediaTypeChange('image')}
                    className={`w-full flex items-center justify-between px-4 py-3 hover:bg-gray-700 transition-colors ${
                      mediaType === 'image' ? 'bg-gray-700' : ''
                    }`}
                  >
                    <div className="flex items-center space-x-3">
                      <svg className="w-5 h-5 text-purple-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                      </svg>
                      <span className="text-white font-medium">Images</span>
                    </div>
                    <span className="inline-flex items-center justify-center min-w-[1.5rem] px-1.5 py-0.5 text-xs font-bold rounded-full bg-gray-600 text-gray-300">
                      {totalCounts.image.toLocaleString()}
                    </span>
                  </button>
                  
                  <button
                    onClick={() => handleMediaTypeChange('video')}
                    className={`w-full flex items-center justify-between px-4 py-3 hover:bg-gray-700 transition-colors ${
                      mediaType === 'video' ? 'bg-gray-700' : ''
                    }`}
                  >
                    <div className="flex items-center space-x-3">
                      <svg className="w-5 h-5 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                      </svg>
                      <span className="text-white font-medium">Videos</span>
                    </div>
                    <span className="inline-flex items-center justify-center min-w-[1.5rem] px-1.5 py-0.5 text-xs font-bold rounded-full bg-gray-600 text-gray-300">
                      {totalCounts.video.toLocaleString()}
                    </span>
                  </button>
                  
                  <button
                    onClick={() => handleMediaTypeChange('favorites')}
                    className={`w-full flex items-center justify-between px-4 py-3 hover:bg-gray-700 transition-colors ${
                      mediaType === 'favorites' ? 'bg-gray-700' : ''
                    }`}
                  >
                    <div className="flex items-center space-x-3">
                      <svg className="w-5 h-5 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
                      </svg>
                      <span className="text-white font-medium">Favorites</span>
                    </div>
                    <span className="inline-flex items-center justify-center min-w-[1.5rem] px-1.5 py-0.5 text-xs font-bold rounded-full bg-gray-600 text-gray-300">
                      {totalCounts.favorites.toLocaleString()}
                    </span>
                  </button>
                </div>
              )}
            </div>
            
            {/* Refresh button */}
            <button
              onClick={refreshMedia}
              disabled={isLoading || isLoadingMore}
              className="p-2.5 bg-gray-800/50 hover:bg-gray-700/50 disabled:bg-gray-800/30 disabled:cursor-not-allowed text-gray-400 hover:text-white rounded-lg transition-all duration-200 group"
              title="Refresh"
            >
              <svg 
                className={`w-5 h-5 ${isLoading || isLoadingMore ? 'animate-spin' : 'group-hover:rotate-180 transition-transform duration-500'}`} 
                fill="none" 
                stroke="currentColor" 
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
            </button>
          </div>
        </div>
      </div>

      {/* Main content */}
      <div className="container mx-auto p-4">

      {media.length === 0 ? (
        <div className="flex flex-col items-center justify-center min-h-[60vh] text-center">
          <svg className="w-16 h-16 text-gray-400 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
          </svg>
          <h3 className="text-xl font-semibold text-white mb-2">
            No {mediaType === 'all' ? 'Media' : 
                mediaType === 'image' ? 'Images' : 
                mediaType === 'video' ? 'Videos' : 'Favorites'} Found
          </h3>
          <p className="text-gray-400 mb-4">
            {isLoading ? 'Loading...' : 
             mediaType === 'favorites' ? 'Mark some items as favorites to see them here' :
             `Upload some ${mediaType === 'all' ? 'photos or videos' : mediaType === 'image' ? 'photos' : 'videos'} to get started`}
          </p>
          <p className="text-sm text-gray-500">Place media files in the imports directory for automatic processing</p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {media.map((item) => (
          <div
            key={item.id}
            className="relative group overflow-hidden rounded-lg shadow-lg transition-transform hover:scale-105 border border-gray-700"
            onMouseEnter={() => setHoveredId(item.id)}
            onMouseLeave={() => setHoveredId(null)}
          >
            {/* Animated Thumbnail */}
            <div 
              className="relative aspect-video bg-gray-900 cursor-pointer"
              onClick={() => setSelectedMedia(item)}
            >
              <AuthenticatedImage
                src={
                  hoveredId === item.id && item.preview_url
                    ? item.preview_url
                    : item.thumbnail_url
                }
                alt={item.name}
                className="w-full h-full"
                loading="lazy"
                objectFit="contain"
              />
              
              {/* Video Duration Overlay */}
              {item.type === 'video' && item.metadata.duration && (
                <div className="absolute bottom-2 right-2 bg-black bg-opacity-75 text-white text-xs px-2 py-1 rounded">
                  {formatDuration(item.metadata.duration)}
                </div>
              )}
              
              {/* Enhanced Play Button Overlay for Videos */}
              {item.type === 'video' && hoveredId === item.id && (
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="relative">
                    {/* Background blur effect */}
                    <div className="absolute inset-0 bg-black bg-opacity-30 backdrop-blur-sm rounded-full scale-150 opacity-0 group-hover:opacity-100 transition-all duration-300"></div>
                    
                    {/* Main play button */}
                    <div className="relative bg-white bg-opacity-90 backdrop-blur-sm rounded-full p-3 shadow-lg transform scale-90 group-hover:scale-100 transition-all duration-300 hover:bg-opacity-100">
                      <svg className="w-8 h-8 text-gray-800 ml-0.5" fill="currentColor" viewBox="0 0 24 24">
                        <path d="M8 5v14l11-7z" />
                      </svg>
                    </div>
                    
                    {/* Animated pulse ring */}
                    <div className="absolute inset-0 bg-white bg-opacity-20 rounded-full animate-ping opacity-0 group-hover:opacity-100"></div>
                  </div>
                </div>
              )}
            </div>
            
            {/* Media Info */}
            <div className="p-3 bg-gray-800 flex items-center justify-between">
              <p className="text-sm font-medium truncate text-white flex-1 pr-2" data-testid={`media-name`}>{item.name}</p>
              
              {/* Favorite Button */}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  toggleFavorite(item.id);
                }}
                className="flex-shrink-0 bg-gray-700 hover:bg-gray-600 rounded-full p-2 transition-all duration-200 group"
                aria-label={item.favorite ? "Remove from favorites" : "Add to favorites"}
              >
                <svg 
                  className={`w-4 h-4 transition-colors ${
                    item.favorite ? 'text-red-500 fill-current' : 'text-gray-400 group-hover:text-red-400'
                  }`}
                  fill={item.favorite ? 'currentColor' : 'none'}
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                  strokeWidth={2}
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
                </svg>
              </button>
            </div>
          </div>
            ))}
          </div>

          {/* Infinite Scroll Loading Indicator - Desktop only */}
          {hasMore && (
            <div ref={loadMoreRef} className="h-20 mt-4 hidden md:block" aria-hidden="true">
              {/* Trigger element for desktop infinite scroll */}
            </div>
          )}
          
          {/* Loading indicator - shown separately */}
          {isLoadingMore && (
            <div className="flex justify-center py-8">
              <div className="flex items-center space-x-2 text-white">
                <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-white"></div>
                <span>Loading more...</span>
              </div>
            </div>
          )}
          
          {/* End of content indicator */}
          {!hasMore && media.length > 0 && (
            <div className="flex flex-col items-center justify-center mt-8 py-4">
              <span className="text-gray-400 text-sm">You&apos;ve reached the end</span>
            </div>
          )}
          
          {/* Mobile swipe hint when more content available */}
          {hasMore && !isLoadingMore && (
            <div className="flex flex-col items-center justify-center mt-8 py-4">
              <span className="text-gray-500 text-xs md:hidden">Swipe up to load more</span>
              {/* Fallback load more button for desktop */}
              <button
                onClick={handleSwipeUpForMore}
                className="hidden md:block mt-2 px-4 py-2 text-sm text-gray-400 hover:text-white border border-gray-600 hover:border-gray-400 rounded-lg transition-colors"
              >
                Load More
              </button>
            </div>
          )}
        </>
      )}

      {/* Media Viewer Modal */}
      {selectedMedia && (
        <div 
          className="fixed inset-0 bg-black bg-opacity-95 z-50 flex flex-col"
          onClick={(e) => e.target === e.currentTarget && setSelectedMedia(null)}
        >
          {/* Header with Close Button and Navigation */}
          <div className="flex justify-between items-center p-4 md:p-6 bg-gradient-to-b from-black/50 to-transparent">
            {/* Navigation Info */}
            <div className="text-white text-sm md:text-base">
              {getCurrentMediaIndex() + 1} of {media.length}
            </div>
            
            {/* Close Button - Safari Optimized */}
            <button
              onClick={() => setSelectedMedia(null)}
              className="flex items-center justify-center w-10 h-10 md:w-12 md:h-12 rounded-full bg-black/30 hover:bg-black/50 transition-colors touch-manipulation"
              style={{ WebkitTapHighlightColor: 'transparent' }}
            >
              <svg 
                className="w-6 h-6 md:w-7 md:h-7 text-white" 
                fill="none" 
                stroke="currentColor" 
                viewBox="0 0 24 24"
                strokeWidth={2.5}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Main Media Container */}
          <div 
            ref={modalRef}
            className="flex-1 flex items-center justify-center px-4 pb-4 md:px-6 md:pb-6 min-h-0"
            onTouchStart={handleTouchStart}
            onTouchMove={handleTouchMove}
            onTouchEnd={handleTouchEnd}
          >
            {/* Navigation Arrows - Desktop Only */}
            <button
              onClick={() => navigateToMedia('prev')}
              className="hidden md:flex absolute left-4 top-1/2 transform -translate-y-1/2 items-center justify-center w-12 h-12 rounded-full bg-black/30 hover:bg-black/50 transition-colors text-white z-10"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </button>

            <button
              onClick={() => navigateToMedia('next')}
              className="hidden md:flex absolute right-4 top-1/2 transform -translate-y-1/2 items-center justify-center w-12 h-12 rounded-full bg-black/30 hover:bg-black/50 transition-colors text-white z-10"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </button>

            {/* Media Display */}
            <div className="w-full h-full flex items-center justify-center">
              {selectedMedia.type === 'video' ? (
                <div className="w-full max-w-7xl">
                  <VideoPlayer videoId={selectedMedia.id} />
                </div>
              ) : (
                <AuthenticatedImage
                  src={`/api/media/stream/${selectedMedia.id}`}
                  alt={selectedMedia.name}
                  className="max-w-full max-h-full object-contain"
                  objectFit="contain"
                  showFullImage={true}
                />
              )}
            </div>
          </div>

          {/* Bottom Info Panel */}
          <div className="bg-gradient-to-t from-black/50 to-transparent p-4 md:p-6">
            <div className="max-w-7xl mx-auto flex items-start justify-between">
              <div className="flex-1">
                <h3 className="text-lg md:text-xl font-semibold text-white truncate">
                  {selectedMedia.name}
                </h3>
                <div className="flex flex-wrap gap-2 md:gap-4 text-sm md:text-base text-gray-300 mt-1">
                  <span>{selectedMedia.metadata.width}x{selectedMedia.metadata.height}</span>
                  <span>•</span>
                  <span>{formatFileSize(selectedMedia.metadata.size_bytes)}</span>
                  {selectedMedia.metadata.duration && (
                    <>
                      <span>•</span>
                      <span>{formatDuration(selectedMedia.metadata.duration)}</span>
                    </>
                  )}
                </div>
                
                {/* Mobile Swipe Hint */}
                <div className="md:hidden mt-3 text-xs text-gray-400">
                  Swipe left/right to navigate • Swipe down to close
                </div>
              </div>
              
              {/* Favorite Button */}
              <button
                onClick={() => toggleFavorite(selectedMedia.id)}
                className="ml-4 flex-shrink-0 bg-black/30 hover:bg-black/50 rounded-full p-3 transition-all duration-200 group"
                aria-label={selectedMedia.favorite ? "Remove from favorites" : "Add to favorites"}
              >
                <svg 
                  className={`w-6 h-6 md:w-7 md:h-7 transition-colors ${
                    selectedMedia.favorite ? 'text-red-500 fill-current' : 'text-white group-hover:text-red-400'
                  }`}
                  fill={selectedMedia.favorite ? 'currentColor' : 'none'}
                  stroke="currentColor" 
                  viewBox="0 0 24 24"
                  strokeWidth={2}
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
                </svg>
              </button>
            </div>
          </div>
        </div>
      )}
      </div>
    </div>
  );
}