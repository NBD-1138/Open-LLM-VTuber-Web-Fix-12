/* eslint-disable import/no-extraneous-dependencies */
/* eslint-disable react-hooks/rules-of-hooks */
import {
  Box,
  HStack,
  Heading,
  Input,
  Spinner,
  Stack,
  Text,
  createListCollection,
} from '@chakra-ui/react';
import {
  useCallback,
  useEffect,
  useMemo,
} from 'react';
import { useTranslation } from 'react-i18next';
import { useLive2dSettings } from '@/hooks/sidebar/setting/use-live2d-settings';
import { SwitchField } from './common';
import { useItemScene } from '@/hooks/items/use-item-scene';
import { Checkbox } from '@/components/ui/checkbox';
import { Slider } from '@/components/ui/slider';
import { Button } from '@/components/ui/button';
import {
  SelectContent,
  SelectItem,
  SelectRoot,
  SelectTrigger,
  SelectValueText,
} from '@/components/ui/select';

interface live2DProps {
  onSave?: (callback: () => void) => () => void
  onCancel?: (callback: () => void) => () => void
}

const DEFAULT_EXPRESSION_VALUE = '__default__';
const SCALE_MIN = 0.005;
const SCALE_MAX = 8;

const scaleToSlider = (scale: number) => {
  const clamped = Math.min(Math.max(scale, SCALE_MIN), SCALE_MAX);
  const ratio = Math.log(clamped / SCALE_MIN) / Math.log(SCALE_MAX / SCALE_MIN);
  return Math.round(ratio * 100);
};

const sliderToScale = (value: number) => {
  const ratio = Math.min(Math.max(value, 0), 100) / 100;
  return SCALE_MIN * (SCALE_MAX / SCALE_MIN) ** ratio;
};

function SectionDivider() {
  return (
    <Box
      borderTopWidth="1px"
      borderColor="whiteAlpha.200"
      my={2}
    />
  );
}

function live2D({ onSave, onCancel }: live2DProps): JSX.Element {
  const { t } = useTranslation();
  const {
    modelInfo,
    handleInputChange,
    handleSave,
    handleCancel,
  } = useLive2dSettings();
  const {
    catalog,
    loadingCatalog,
    activeItems,
    runtimeReady,
    editingItemId,
    showItem,
    hideItem,
    setPinned,
    setScale,
    setZIndex,
    setExpression,
    playMotion,
    setLipSync,
    recenterItem,
    setEditingItemId,
  } = useItemScene();

  const visibleAssetKeys = useMemo(() => {
    const keys = new Set<string>();
    activeItems.forEach((item) => {
      keys.add(item.assetKey);
    });
    return keys;
  }, [activeItems]);

  const handleShowAsset = useCallback(async (assetKey: string) => {
    if (!runtimeReady) return;
    try {
      await showItem(assetKey);
    } catch (error) {
      console.error('[Live2D Settings] Failed to show item', error);
    }
  }, [runtimeReady, showItem]);

  const handleHideAsset = useCallback(async (assetKey: string) => {
    if (!runtimeReady) return;
    const targets = activeItems.filter((item) => item.assetKey === assetKey);
    await Promise.all(
      targets.map((item) => hideItem(item.itemId).catch((error: unknown) => {
        console.error('[Live2D Settings] Failed to hide item', error);
      })),
    );
  }, [activeItems, hideItem, runtimeReady]);

  const handleRecenter = useCallback(async (itemId: string) => {
    if (!runtimeReady) return;
    try {
      await recenterItem(itemId);
    } catch (error) {
      console.error('[Live2D Settings] Failed to recenter item', error);
    }
  }, [recenterItem, runtimeReady]);

  useEffect(() => {
    if (!onSave || !onCancel) return;

    const cleanupSave = onSave(handleSave);
    const cleanupCancel = onCancel(handleCancel);

    return (): void => {
      cleanupSave?.();
      cleanupCancel?.();
    };
  }, [handleCancel, handleSave, onCancel, onSave]);

  return (
    <Stack gap={6} width="100%" maxW="full" align="stretch">
      <SwitchField
        label={t('settings.live2d.pointerInteractive')}
        checked={modelInfo.pointerInteractive ?? false}
        onChange={(checked) => handleInputChange('pointerInteractive', checked)}
      />

      <SwitchField
        label={t('settings.live2d.scrollToResize')}
        checked={modelInfo.scrollToResize ?? true}
        onChange={(checked) => handleInputChange('scrollToResize', checked)}
      />

      <SectionDivider />

      <Box>
        <Heading as="h4" size="sm" mb={2}>
          {t('settings.live2d.itemLibrary', 'Item Library')}
        </Heading>
        {loadingCatalog ? (
          <HStack gap={2}>
            <Spinner size="sm" />
            <Text fontSize="sm" color="gray.400">
              {t('settings.live2d.loadingItems', 'Loading items...')}
            </Text>
          </HStack>
        ) : (
          <Stack gap={2}>
            {catalog.length === 0 ? (
              <Text fontSize="sm" color="gray.400">
                {t('settings.live2d.noItemsFound', 'No items detected in live2d-models/items.')}
              </Text>
            ) : (
              catalog.map((asset) => {
                const isVisible = visibleAssetKeys.has(asset.assetKey);
                const displayName =
                  asset.kind === 'live2d'
                    ? asset.displayName.replace(/\.model3?(\.json)?$/i, '')
                    : asset.displayName;
                return (
                  <HStack
                    key={asset.assetKey}
                    justify="space-between"
                    borderWidth="1px"
                    borderRadius="md"
                    px={3}
                    py={2}
                    opacity={runtimeReady || isVisible ? 1 : 0.6}
                  >
                    <Stack gap={0}>
                      <Text fontWeight="medium">{displayName}</Text>
                      <Text fontSize="xs" color="gray.500">
                        {asset.kind === 'live2d'
                          ? t('settings.live2d.kindLive2D', 'Live2D Model')
                          : t('settings.live2d.kindPng', 'PNG Prop')}
                      </Text>
                    </Stack>
                    <Button
                      size="sm"
                      variant={isVisible ? 'outline' : 'solid'}
                      colorScheme={isVisible ? 'red' : 'blue'}
                      disabled={!isVisible && !runtimeReady}
                      onClick={() => (isVisible
                        ? handleHideAsset(asset.assetKey)
                        : handleShowAsset(asset.assetKey))}
                    >
                      {isVisible
                        ? t('settings.live2d.hide', 'Hide')
                        : t('settings.live2d.show', 'Show')}
                    </Button>
                  </HStack>
                );
              })
            )}
          </Stack>
        )}
      </Box>

      <SectionDivider />

      <Box>
        <Heading as="h4" size="sm" mb={2}>
          {t('settings.live2d.activeItems', 'Active Items')}
        </Heading>
        {activeItems.length === 0 ? (
          <Text fontSize="sm" color="gray.400">
            {t('settings.live2d.noActiveItems', 'No active items for this avatar.')}
          </Text>
        ) : (
          <Stack gap={3}>
            {activeItems.map((item) => {
              const expressionItems =
                item.kind === 'live2d' && item.availableExpressions?.length
                  ? [
                    {
                      value: DEFAULT_EXPRESSION_VALUE,
                      label: t('settings.live2d.expressionDefault', 'Default'),
                    },
                    ...item.availableExpressions.map((expression) => ({
                      value: expression,
                      label: expression,
                    })),
                  ]
                  : null;
              const expressionCollection = expressionItems
                ? createListCollection({ items: expressionItems })
                : null;

              const motionItems =
                item.kind === 'live2d' && item.availableMotions?.length
                  ? item.availableMotions.map((motion) => ({
                    value: motion,
                    label: motion,
                  }))
                  : null;
              const motionCollection = motionItems
                ? createListCollection({ items: motionItems })
                : null;

              return (
                <Box
                  key={item.itemId}
                  borderWidth="1px"
                  borderRadius="md"
                  px={3}
                  py={3}
                >
                  <HStack justify="space-between" align="start">
                    <Stack gap={0}>
                      <Text fontWeight="medium">{item.assetKey}</Text>
                      <Text fontSize="xs" color="gray.500">
                        {item.kind === 'live2d'
                          ? t('settings.live2d.kindLive2D', 'Live2D Model')
                          : t('settings.live2d.kindPng', 'PNG Prop')}
                      </Text>
                    </Stack>
                    <HStack gap={2}>
                      <Button
                        size="xs"
                        variant="outline"
                        onClick={() => handleRecenter(item.itemId)}
                      >
                        {t('settings.live2d.recenter', 'Recenter')}
                      </Button>
                      <Button
                        size="xs"
                        colorScheme="red"
                        onClick={() => hideItem(item.itemId).catch((error: unknown) => {
                          console.error('[Live2D Settings] Failed to hide item', error);
                        })}
                      >
                        {t('settings.live2d.hide', 'Hide')}
                      </Button>
                    </HStack>
                  </HStack>

                  <Stack gap={3} mt={3}>
                    <HStack justify="space-between" align="center">
                      <Checkbox
                        checked={item.pinnedToAvatar}
                        disabled={!runtimeReady}
                        onCheckedChange={(details) => setPinned(item.itemId, details.checked === true).catch((error: unknown) => {
                          console.error('[Live2D Settings] Failed to toggle pinned', error);
                        })}
                      >
                        {t('settings.live2d.pinnedToAvatar', 'Pinned to Avatar')}
                      </Checkbox>
                      <Button
                        size="xs"
                        variant={editingItemId === item.itemId ? 'solid' : 'outline'}
                        colorScheme={editingItemId === item.itemId ? 'blue' : 'gray'}
                        disabled={!runtimeReady}
                        onClick={() => setEditingItemId(editingItemId === item.itemId ? null : item.itemId)}
                      >
                        {editingItemId === item.itemId
                          ? t('settings.live2d.editingItem', 'Editing')
                          : t('settings.live2d.editItem', 'Edit Item')}
                      </Button>
                    </HStack>

                    <Box>
                      <Text fontSize="sm" mb={1}>
                        {t('settings.live2d.scale', 'Scale')}
                        :
                        {' '}
                        {item.scale.toFixed(2)}
                      </Text>
                      <Slider
                        aria-label={[`scale-${item.itemId}`]}
                        value={[scaleToSlider(item.scale)]}
                        min={0}
                        max={100}
                        step={1}
                        disabled={!runtimeReady}
                        onValueChange={(details) => {
                          const [next] = details.value;
                          if (typeof next === 'number') {
                            const nextScale = sliderToScale(next);
                            setScale(item.itemId, nextScale).catch((error: unknown) => {
                              console.error('[Live2D Settings] Failed to set scale', error);
                            });
                          }
                        }}
                      />
                    </Box>

                    <Box>
                      <Text fontSize="sm" mb={1}>
                        {t('settings.live2d.zIndex', 'Z-Index')}
                      </Text>
                      <Input
                        size="sm"
                        type="number"
                        value={item.zIndex}
                        disabled={!runtimeReady}
                        onChange={(event) => {
                          const value = Number(event.target.value);
                          const parsed = Number.isFinite(value) ? value : item.zIndex;
                          setZIndex(item.itemId, parsed).catch((error: unknown) => {
                            console.error('[Live2D Settings] Failed to set z-index', error);
                          });
                        }}
                      />
                    </Box>

                    {expressionItems && expressionCollection ? (
                      <Box>
                        <Text fontSize="sm" mb={1}>
                          {t('settings.live2d.expression', 'Expression')}
                        </Text>
                        <SelectRoot
                          size="sm"
                          collection={expressionCollection}
                          value={[item.currentExpression ?? DEFAULT_EXPRESSION_VALUE]}
                          disabled={!runtimeReady}
                          onValueChange={(details) => {
                            const nextValue = details.value[0] ?? DEFAULT_EXPRESSION_VALUE;
                            const parsed =
                              !nextValue || nextValue === DEFAULT_EXPRESSION_VALUE
                                ? null
                                : nextValue;
                            setExpression(item.itemId, parsed).catch((error: unknown) => {
                              console.error('[Live2D Settings] Failed to set expression', error);
                            });
                          }}
                        >
                          <SelectTrigger>
                            <SelectValueText placeholder={t('settings.live2d.expressionDefault', 'Default')} />
                          </SelectTrigger>
                          <SelectContent>
                            {expressionItems.map((option) => (
                              <SelectItem key={option.value} item={option}>
                                {option.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </SelectRoot>
                      </Box>
                    ) : null}

                    {motionItems && motionCollection ? (
                      <Box>
                        <Text fontSize="sm" mb={1}>
                          {t('settings.live2d.motion', 'Motion')}
                        </Text>
                        <SelectRoot
                          size="sm"
                          collection={motionCollection}
                          value={[]}
                          disabled={!runtimeReady}
                          onValueChange={(details) => {
                            const next = details.value[0];
                            if (next) {
                              playMotion(item.itemId, next).catch((error: unknown) => {
                                console.error('[Live2D Settings] Failed to play motion', error);
                              });
                            }
                          }}
                        >
                          <SelectTrigger>
                            <SelectValueText placeholder={t('settings.live2d.motionPlaceholder', 'Select motion')} />
                          </SelectTrigger>
                          <SelectContent>
                            {motionItems.map((option) => (
                              <SelectItem key={option.value} item={option}>
                                {option.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </SelectRoot>
                      </Box>
                    ) : null}

                    {item.kind === 'live2d' ? (
                      <Checkbox
                        checked={item.enableLipSync ?? false}
                        disabled={!runtimeReady}
                        onCheckedChange={(details) => setLipSync(item.itemId, details.checked === true).catch((error: unknown) => {
                          console.error('[Live2D Settings] Failed to toggle lip sync', error);
                        })}
                      >
                        {t('settings.live2d.lipSync', 'Lip Sync')}
                      </Checkbox>
                    ) : null}
                  </Stack>
                </Box>
              );
            })}
          </Stack>
        )}
      </Box>
    </Stack>
  );
}

export default live2D;
