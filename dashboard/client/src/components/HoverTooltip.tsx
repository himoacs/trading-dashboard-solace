import React, { useState, useRef, useEffect, ReactNode } from 'react';
import ReactDOM from 'react-dom';

interface HoverTooltipProps {
  children: ReactNode; // The content that will trigger the tooltip on hover
  tooltipContent: ReactNode; // The content to display in the tooltip
  tooltipClassName?: string; // Optional classes for the tooltip itself
}

const HoverTooltip: React.FC<HoverTooltipProps> = ({ 
  children, 
  tooltipContent,
  tooltipClassName = '' 
}) => {
  const [isVisible, setIsVisible] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const triggerRef = useRef<HTMLDivElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);

  const tooltipRoot = document.getElementById('tooltip-root');

  useEffect(() => {
    if (!tooltipRoot) {
      const newRoot = document.createElement('div');
      newRoot.setAttribute('id', 'tooltip-root');
      document.body.appendChild(newRoot);
    }
  }, [tooltipRoot]);


  const handleMouseEnter = () => {
    if (triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect();
      const tooltipElement = tooltipRef.current; // Get a reference to the tooltip for its dimensions

      let newTop = rect.bottom + window.scrollY + 5; // Default: 5px below trigger
      let newLeft = rect.left + window.scrollX - 100;  // Shifted 100px to the left from trigger start

      if (tooltipElement) {
        const tooltipHeight = tooltipElement.offsetHeight;
        const tooltipWidth = tooltipElement.offsetWidth;

        // Check for vertical overflow (bottom of screen)
        if (newTop + tooltipHeight > window.innerHeight + window.scrollY) {
          newTop = rect.top + window.scrollY - tooltipHeight - 5; // Position 5px above trigger
        }

        // Check for horizontal overflow (right of screen)
        if (newLeft + tooltipWidth > window.innerWidth + window.scrollX) {
          newLeft = window.innerWidth + window.scrollX - tooltipWidth - 10; // 10px margin from right edge
        }
      }

      // Ensure it's not off-screen top or left after adjustments
      if (newTop < window.scrollY + 10) newTop = window.scrollY + 10; // 10px margin from top edge
      if (newLeft < window.scrollX + 10) newLeft = window.scrollX + 10; // 10px margin from left edge

      setPosition({ top: newTop, left: newLeft });
      setIsVisible(true);
    }
  };

  const handleMouseLeave = () => {
    setIsVisible(false);
  };
  
  const handleFocus = () => {
    if (triggerRef.current) {
      handleMouseEnter(); // Reuse mouse enter logic for focus
    }
  };

  const handleBlur = () => {
    handleMouseLeave(); // Reuse mouse leave logic for blur
  };


  const portalElement = document.getElementById('tooltip-root');

  return (
    <div 
      ref={triggerRef} 
      onMouseEnter={handleMouseEnter} 
      onMouseLeave={handleMouseLeave}
      onFocus={handleFocus} // Added for accessibility
      onBlur={handleBlur}   // Added for accessibility
      className="inline-block" // Or "relative" if children need to be positioned relative to this
      tabIndex={0} // Make it focusable
    >
      {children}
      {isVisible && portalElement && ReactDOM.createPortal(
        <div
          ref={tooltipRef}
          style={{ top: `${position.top}px`, left: `${position.left}px` }}
          className={`fixed z-[9999] bg-white dark:bg-gray-800 p-3 rounded-md shadow-xl border border-gray-200 dark:border-gray-700 text-sm whitespace-normal transition-opacity duration-150 ${
            isVisible ? 'opacity-100' : 'opacity-0'
          } ${tooltipClassName}`}
        >
          {tooltipContent}
        </div>,
        portalElement
      )}
    </div>
  );
};

export default HoverTooltip; 