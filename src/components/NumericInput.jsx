import React, { useState, useEffect, useRef } from 'react';

export const NumericInput = ({ value, onChange, onBlur, placeholder, allowNegative = false, allowDecimal = true, ...props }) => {
  const isFocusedRef = useRef(false);

  // Initialize internal display string
  const formatInitial = (val) => {
    if (val === undefined || val === null || val === '') return '';
    return String(val);
  };

  const [internal, setInternal] = useState(() => formatInitial(value));

  // Sync from external value changes when not actively typing or if external value diverges significantly
  useEffect(() => {
    if (!isFocusedRef.current) {
      setInternal(formatInitial(value));
    } else {
      // While focused, only update if external value is not just the numeric equivalent of our internal string
      if (internal === '' && (value === '' || value === null || value === undefined)) {
        // do nothing
      } else if (internal === '' && (value === 0 || value === '0')) {
        // preserve the user's active empty editing state! Do not force '0' back while focused.
      } else if (Number(internal) !== Number(value) && String(value) !== internal) {
        setInternal(formatInitial(value));
      }
    }
  }, [value]);

  const handleChange = (e) => {
    let raw = e.target.value;

    // Filter valid characters: digits, optional minus sign at start, optional single decimal point
    let filtered = '';
    let hasDecimal = false;

    for (let i = 0; i < raw.length; i++) {
      const char = raw[i];
      if (char >= '0' && char <= '9') {
        filtered += char;
      } else if (char === '-' && allowNegative && i === 0) {
        filtered += char;
      } else if (char === '.' && allowDecimal && !hasDecimal) {
        filtered += char;
        hasDecimal = true;
      }
    }

    // Clean up leading zeros: e.g. "05" -> "5", "00" -> "0", "-05" -> "-5"
    // But keep "0", "0.", "0.xx", "-0", "-0."
    let cleaned = filtered;
    if (/^-?0[0-9]+/.test(cleaned)) {
      if (cleaned.startsWith('-')) {
        cleaned = '-' + cleaned.slice(2).replace(/^0+/, (match) => (match ? '' : ''));
        if (cleaned === '-') cleaned = '-0';
      } else {
        cleaned = cleaned.replace(/^0+/, '');
        if (cleaned === '') cleaned = '0';
      }
    }

    setInternal(cleaned);

    if (onChange) {
      const synthEvent = {
        ...e,
        target: {
          ...e.target,
          name: props.name,
          value: cleaned
        }
      };
      onChange(synthEvent);
    }
  };

  const handleFocus = (e) => {
    isFocusedRef.current = true;
    if (props.onFocus) props.onFocus(e);
  };

  const handleBlur = (e) => {
    isFocusedRef.current = false;
    if (onBlur) onBlur(e);
    if (props.onBlur && props.onBlur !== onBlur) props.onBlur(e);
  };

  return (
    <input
      type="text"
      inputMode={allowDecimal ? "decimal" : "numeric"}
      value={internal}
      onChange={handleChange}
      onFocus={handleFocus}
      onBlur={handleBlur}
      placeholder={placeholder !== undefined ? placeholder : '0'}
      {...props}
    />
  );
};
