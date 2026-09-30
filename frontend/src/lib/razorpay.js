import { api } from "./api";

let scriptPromise = null;

export const loadRazorpayScript = () => {
  if (window.Razorpay) return Promise.resolve(true);
  if (scriptPromise) return scriptPromise;
  scriptPromise = new Promise((resolve) => {
    const s = document.createElement("script");
    s.src = "https://checkout.razorpay.com/v1/checkout.js";
    s.onload = () => resolve(true);
    s.onerror = () => { scriptPromise = null; resolve(false); };
    document.body.appendChild(s);
  });
  return scriptPromise;
};

// Opens Razorpay Checkout for a contest; resolves with the approved entry, rejects on failure/dismiss.
export const payForContest = async (contest) => {
  const ok = await loadRazorpayScript();
  if (!ok) throw new Error("Could not load payment gateway. Check your connection.");
  const { data: order } = await api.post("/payments/razorpay/order", { contest_id: contest.id });
  return new Promise((resolve, reject) => {
    const rzp = new window.Razorpay({
      key: order.key_id,
      amount: order.amount,
      currency: order.currency,
      name: "PitchPlay",
      description: `Entry fee · ${order.contest_title}`,
      order_id: order.order_id,
      prefill: order.prefill,
      theme: { color: "#059669" },
      handler: async (res) => {
        try {
          const { data } = await api.post("/payments/razorpay/verify", res);
          resolve(data);
        } catch (e) {
          reject(new Error(e?.response?.data?.detail || "Payment verification failed"));
        }
      },
      modal: { ondismiss: () => reject(new Error("Payment cancelled")) },
    });
    rzp.on("payment.failed", (r) => reject(new Error(r?.error?.description || "Payment failed")));
    rzp.open();
  });
};
