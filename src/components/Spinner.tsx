import React from 'react';
import './Spinner.css';

interface SpinnerProps {
  size?: 'small' | 'medium' | 'large';
  color?: string;
  message?: string;
}

const Spinner: React.FC<SpinnerProps> = ({ 
  size = 'medium', 
  color = 'var(--color-primary)',
  message 
}) => {
  const sizeMap = {
    small: 24,
    medium: 40,
    large: 64
  };

  const spinnerSize = sizeMap[size];

  return (
    <div className="spinner-container">
      <div 
        className="spinner" 
        style={{ 
          width: spinnerSize, 
          height: spinnerSize,
          borderTopColor: color,
          borderRightColor: 'transparent',
          borderBottomColor: 'transparent',
          borderLeftColor: 'transparent'
        }}
      />
      {message && <p className="spinner-message">{message}</p>}
    </div>
  );
};

export default Spinner;
