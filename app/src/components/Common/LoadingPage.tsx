import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";

export const LoadingPage = () => {
  const [show, setShow] = useState(true);
  
  useEffect(() => {
    const minDisplayTime = 500;
    const startTime = Date.now();
    
    return () => {
      const elapsedTime = Date.now() - startTime;
      if (elapsedTime < minDisplayTime) {
        const remainingTime = minDisplayTime - elapsedTime;
        setTimeout(() => setShow(false), remainingTime);
      } else {
        setShow(false);
      }
    };
  }, []);

  return (
    <AnimatePresence>
      {show && (
        <motion.div 
          className="fixed inset-0 flex items-center justify-center bg-[#14121a]"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.3 }}
          role="status"
          aria-label="Loading bkemo"
        >
          <motion.svg
            viewBox="0 0 64 64"
            className="h-[70px] w-[70px] md:h-[100px] md:w-[100px]"
            initial={{ scale: 0.96, opacity: 0.72 }}
            animate={{ scale: [0.96, 1, 0.96], opacity: [0.72, 1, 0.72] }}
            transition={{ duration: 1.2, ease: "easeInOut", repeat: Infinity }}
            aria-hidden="true"
          >
            <rect width="64" height="64" rx="14" fill="#1b1923" stroke="#34303f" />
            <path
              d="M21.25 10.625V42C21.25 48.125 26.188 53.125 32.375 53.125H39.25C48.25 53.125 55.5 45.813 55.5 36.875V33.75C55.5 24.813 48.25 17.5 39.25 17.5H28.438"
              fill="none"
              stroke="#f4eeff"
              strokeWidth="5.75"
              strokeLinecap="square"
              strokeLinejoin="round"
            />
            <motion.rect
              x="18.375"
              y="26.875"
              width="5.75"
              height="11.25"
              rx="0.75"
              fill="#5e6ad2"
              animate={{ opacity: [0.45, 1, 0.45] }}
              transition={{ duration: 1.2, ease: "easeInOut", repeat: Infinity }}
            />
          </motion.svg>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
