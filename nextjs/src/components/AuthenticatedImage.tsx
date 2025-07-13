'use client';

import { useAuthenticatedImage } from '@/hooks/useAuthenticatedImage';

interface AuthenticatedImageProps {
  src: string;
  alt: string;
  className?: string;
  loading?: 'lazy' | 'eager';
  onLoad?: () => void;
  onError?: () => void;
  objectFit?: 'contain' | 'cover' | 'fill' | 'none' | 'scale-down';
  showFullImage?: boolean;
}

export default function AuthenticatedImage({ 
  src, 
  alt, 
  className, 
  loading = 'lazy',
  onLoad,
  onError,
  objectFit = 'cover',
  showFullImage = false
}: AuthenticatedImageProps) {
  const { imageSrc, isLoading, error } = useAuthenticatedImage(src);

  if (isLoading) {
    return (
      <div className={`${className} bg-gray-800 animate-pulse`} />
    );
  }

  if (error) {
    onError?.();
    return (
      <div className={`${className} bg-gray-800 flex items-center justify-center`}>
        <span className="text-gray-500 text-xs">Failed to load</span>
      </div>
    );
  }

  const getObjectFitClass = () => {
    switch (objectFit) {
      case 'contain': return 'object-contain';
      case 'cover': return 'object-cover';
      case 'fill': return 'object-fill';
      case 'none': return 'object-none';
      case 'scale-down': return 'object-scale-down';
      default: return 'object-cover';
    }
  };

  const finalClassName = showFullImage 
    ? `${className} ${getObjectFitClass()} w-full h-auto`
    : `${className} ${getObjectFitClass()}`;

  if (!imageSrc) {
    return (
      <div className={`${className} bg-gray-800 animate-pulse`} />
    );
  }

  return (
    <img
      src={imageSrc}
      alt={alt}
      className={finalClassName}
      loading={loading}
      onLoad={onLoad}
      onError={onError}
    />
  );
}