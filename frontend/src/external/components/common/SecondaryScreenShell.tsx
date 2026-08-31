/**
 * CPA secondary-development SecondaryScreenShell wrapper.
 *
 * Extends the community SecondaryScreenShell with:
 * - floatingAction: portal-rendered floating action bar
 * - hideTopBarBackButton / hideTopBarRightAction: conditional top bar visibility
 * - PageTransitionLayer integration for current-layer-aware rendering
 *
 * Uses NEW class names (defined in external SCSS) to avoid touching community styles.
 */

import {
  forwardRef,
  useLayoutEffect,
  useRef,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import {
  SecondaryScreenShell as CommunityShell,
  type SecondaryScreenShellProps as CommunityProps,
} from '@/components/common/SecondaryScreenShell';
import { usePageTransitionLayer } from '@/components/common/PageTransitionLayer';
import extStyles from './SecondaryScreenShell.module.scss';

export type SecondaryScreenShellProps = Omit<CommunityProps, 'contentClassName'> & {
  hideTopBarBackButton?: boolean;
  hideTopBarRightAction?: boolean;
  floatingAction?: ReactNode;
  contentClassName?: string;
};

export const SecondaryScreenShell = forwardRef<HTMLDivElement, SecondaryScreenShellProps>(
  function SecondaryScreenShell(
    {
      hideTopBarBackButton = false,
      hideTopBarRightAction = false,
      floatingAction,
      contentClassName = '',
      children,
      rightAction,
      ...rest
    },
    ref
  ) {
    const pageTransitionLayer = usePageTransitionLayer();
    const isCurrentLayer = pageTransitionLayer ? pageTransitionLayer.isCurrentLayer : true;
    const shouldRenderFloatingAction = Boolean(floatingAction) && isCurrentLayer;
    const floatingActionRef = useRef<HTMLDivElement | null>(null);

    useLayoutEffect(() => {
      if (!shouldRenderFloatingAction) return;
      const element = floatingActionRef.current;
      if (!element) return;

      const updateHeight = () => {
        const height = element.getBoundingClientRect().height;
        document.documentElement.style.setProperty(
          '--secondary-shell-floating-action-height',
          `${height}px`
        );
      };

      updateHeight();
      window.addEventListener('resize', updateHeight);
      const resizeObserver =
        typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(updateHeight);
      resizeObserver?.observe(element);

      return () => {
        resizeObserver?.disconnect();
        window.removeEventListener('resize', updateHeight);
        document.documentElement.style.removeProperty(
          '--secondary-shell-floating-action-height'
        );
      };
    }, [shouldRenderFloatingAction]);

    const effectiveContentClassName = [
      floatingAction ? extStyles.contentWithFloatingAction : '',
      contentClassName,
    ]
      .filter(Boolean)
      .join(' ');

    // When hiding back button, don't pass onBack so community shell renders empty div
    const { onBack, ...restWithoutBack } = rest;
    const effectiveOnBack = hideTopBarBackButton ? undefined : onBack;
    const effectiveRightAction = hideTopBarRightAction ? null : rightAction;

    return (
      <>
        <CommunityShell
          ref={ref}
          contentClassName={effectiveContentClassName}
          rightAction={effectiveRightAction}
          onBack={effectiveOnBack}
          {...restWithoutBack}
        >
          {children}
        </CommunityShell>

        {shouldRenderFloatingAction && typeof document !== 'undefined'
          ? createPortal(
              <div className={extStyles.floatingActionContainer}>
                <div className={extStyles.floatingActionSurface} ref={floatingActionRef}>
                  {floatingAction}
                </div>
              </div>,
              document.body
            )
          : null}
      </>
    );
  }
);
