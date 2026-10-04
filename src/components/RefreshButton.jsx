import React, { useState } from 'react';
import { RefreshCw } from 'lucide-react';
import toast from 'react-hot-toast';
import { motion } from 'framer-motion';

export const RefreshButton = () => {
  const [isRefreshing, setIsRefreshing] = useState(false);

  const handleRefresh = () => {
    setIsRefreshing(true);
    // Simulate network delay for refresh
    setTimeout(() => {
      setIsRefreshing(false);
      toast.success('Data refreshed successfully.', {
        style: {
          borderRadius: '8px',
          background: '#333',
          color: '#fff',
          fontSize: '14px',
        },
      });
    }, 800);
  };

  return (
    <button 
      onClick={handleRefresh} 
      disabled={isRefreshing}
      style={{ 
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: '36px',
        height: '36px',
        borderRadius: '8px',
        background: '#111827',
        color: '#ffffff',
        border: '1px solid #1f2937',
        cursor: isRefreshing ? 'not-allowed' : 'pointer',
        transition: 'all 0.2s ease',
        boxShadow: '0 1px 2px rgba(0,0,0,0.05)',
        flexShrink: 0
      }}
      title="Refresh Data"
    >
      <motion.div
        animate={{ rotate: isRefreshing ? 360 : 0 }}
        transition={{ duration: 1, repeat: isRefreshing ? Infinity : 0, ease: "linear" }}
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      >
        <RefreshCw size={15} color="#ffffff" />
      </motion.div>
    </button>
  );
};
