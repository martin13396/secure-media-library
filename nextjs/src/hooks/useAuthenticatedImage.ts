import { useState, useEffect } from 'react';
import apiClient from '@/lib/api-client';

export function useAuthenticatedImage(url: string | null) {
  const [imageSrc, setImageSrc] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!url) {
      setImageSrc(null);
      return;
    }

    let isMounted = true;
    const loadImage = async () => {
      try {
        setIsLoading(true);
        setError(null);

        // Fetch the image with authentication
        const response = await apiClient.get(url, {
          responseType: 'blob'
        });

        if (isMounted) {
          // Create object URL from blob
          const imageUrl = URL.createObjectURL(response.data);
          setImageSrc(imageUrl);
        }
      } catch (err) {
        if (isMounted) {
          console.error('Failed to load image:', err);
          setError('Failed to load image');
        }
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    };

    loadImage();

    // Cleanup function to revoke object URL
    return () => {
      isMounted = false;
      if (imageSrc && imageSrc.startsWith('blob:')) {
        URL.revokeObjectURL(imageSrc);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url]);

  return { imageSrc, isLoading, error };
}