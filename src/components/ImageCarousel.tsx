/**
 * PTP Mobile App - Image Carousel Component
 *
 * Features:
 * - Auto-scrolling image carousel
 * - Manual swipe navigation
 * - Dot indicators
 * - Customizable height and interval
 */

import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  View,
  Image,
  StyleSheet,
  Dimensions,
  FlatList,
  ViewToken,
  TouchableOpacity,
} from 'react-native';
import { colors, borderRadius } from '../theme';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

interface ImageCarouselProps {
  images: string[];
  height?: number;
  autoPlay?: boolean;
  autoPlayInterval?: number;
  showDots?: boolean;
  borderRadiusSize?: number;
  onImagePress?: (index: number) => void;
}

export const ImageCarousel: React.FC<ImageCarouselProps> = ({
  images,
  height = 200,
  autoPlay = true,
  autoPlayInterval = 4000,
  showDots = true,
  borderRadiusSize = borderRadius.lg,
  onImagePress,
}) => {
  const [activeIndex, setActiveIndex] = useState(0);
  const flatListRef = useRef<FlatList>(null);
  const autoPlayRef = useRef<NodeJS.Timeout | null>(null);

  // Handle viewable items change
  const onViewableItemsChanged = useCallback(
    ({ viewableItems }: { viewableItems: ViewToken[] }) => {
      if (viewableItems.length > 0 && viewableItems[0].index !== null) {
        setActiveIndex(viewableItems[0].index);
      }
    },
    []
  );

  const viewabilityConfig = useRef({
    itemVisiblePercentThreshold: 50,
  }).current;

  // Auto-play functionality
  useEffect(() => {
    if (autoPlay && images.length > 1) {
      autoPlayRef.current = setInterval(() => {
        const nextIndex = (activeIndex + 1) % images.length;
        flatListRef.current?.scrollToIndex({
          index: nextIndex,
          animated: true,
        });
      }, autoPlayInterval);
    }

    return () => {
      if (autoPlayRef.current) {
        clearInterval(autoPlayRef.current);
      }
    };
  }, [autoPlay, autoPlayInterval, activeIndex, images.length]);

  // Scroll to specific index when dot is pressed
  const scrollToIndex = (index: number) => {
    flatListRef.current?.scrollToIndex({
      index,
      animated: true,
    });
  };

  const renderImage = ({ item, index }: { item: string; index: number }) => (
    <TouchableOpacity
      activeOpacity={onImagePress ? 0.9 : 1}
      onPress={() => onImagePress?.(index)}
      disabled={!onImagePress}
    >
      <Image
        source={{ uri: item }}
        style={[
          styles.image,
          { height, borderRadius: borderRadiusSize },
        ]}
        resizeMode="cover"
      />
    </TouchableOpacity>
  );

  if (images.length === 0) {
    return null;
  }

  return (
    <View style={styles.container}>
      <FlatList
        ref={flatListRef}
        data={images}
        renderItem={renderImage}
        keyExtractor={(_, index) => index.toString()}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onViewableItemsChanged={onViewableItemsChanged}
        viewabilityConfig={viewabilityConfig}
        getItemLayout={(_, index) => ({
          length: SCREEN_WIDTH,
          offset: SCREEN_WIDTH * index,
          index,
        })}
        snapToInterval={SCREEN_WIDTH}
        decelerationRate="fast"
      />

      {/* Dot Indicators */}
      {showDots && images.length > 1 && (
        <View style={styles.dotsContainer}>
          {images.map((_, index) => (
            <TouchableOpacity
              key={index}
              onPress={() => scrollToIndex(index)}
              style={[
                styles.dot,
                index === activeIndex ? styles.dotActive : styles.dotInactive,
              ]}
            />
          ))}
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    width: '100%',
  },
  image: {
    width: SCREEN_WIDTH,
  },
  dotsContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 12,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginHorizontal: 4,
  },
  dotActive: {
    backgroundColor: colors.primary,
    width: 24,
  },
  dotInactive: {
    backgroundColor: colors.border,
  },
});

export default ImageCarousel;
