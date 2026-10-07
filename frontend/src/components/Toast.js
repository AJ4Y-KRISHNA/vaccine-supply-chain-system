import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from "react";

const ToastContext = createContext();

export const ToastProvider = ({ children }) => {
  const [toasts, setToasts] = useState([]);
  const sequence = useRef(0);
  const timers = useRef(new Set());
  useEffect(() => () => { for (const timer of timers.current) clearTimeout(timer); }, []);

  const addToast = useCallback((type, message) => {
    const id = ++sequence.current;
    setToasts((prev) => [...prev, { id, type, message }]);
    const timer = setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
      timers.current.delete(timer);
    }, 6000);
    timers.current.add(timer);
  }, []);

  return (
    <ToastContext.Provider value={{ addToast }}>
      {children}
      <div className="toast-stack fixed top-4 right-4 space-y-3 z-50" aria-live="polite">
        {toasts.map((t) => (
          <div
            key={t.id}
            role={t.type === "error" ? "alert" : "status"}
            className={`px-4 py-3 rounded-2xl shadow-lg border text-sm ${
              t.type === "error"
                ? "bg-red-50 border-red-200 text-red-700"
                : "bg-green-50 border-green-200 text-green-700"
            }`}
          >
            {t.message}
            <button type="button" aria-label="Dismiss notification" className="ml-3 rounded px-2 font-semibold" onClick={() => setToasts(previous => previous.filter(item => item.id !== t.id))}>×</button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
};

export const useToast = () => useContext(ToastContext);
