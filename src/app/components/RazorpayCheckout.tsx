"use client";

import { useState } from "react";

declare global {
  interface Window {
    Razorpay: any;
  }
}

interface RazorpayCheckoutProps {
  amountPaise: number;
}

export default function RazorpayCheckout({
  amountPaise,
}: RazorpayCheckoutProps) {
  const [loading, setLoading] = useState(false);

  async function handlePayment() {
    try {
      setLoading(true);

      const keyId =
        document.querySelector<HTMLElement>(
          ".site",
        )?.dataset.razorpayKey;

      if (!keyId) {
        throw new Error("Razorpay key ID is not configured");
      }

      const orderResponse = await fetch(
        "/api/razorpay/order",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            amountPaise,
          }),
        },
      );

      if (!orderResponse.ok) {
        throw new Error(
          "Failed to create Razorpay order",
        );
      }

      const order = await orderResponse.json();

if (
  !order.order ||
  !order.order.id
) {
  throw new Error(
    "Razorpay order response is invalid",
  );
}

if (!window.Razorpay) {
  throw new Error(
    "Razorpay Checkout SDK is not loaded",
  );
}

const razorpay = new window.Razorpay({
  key: keyId,
  amount: order.order.amount,
  currency: order.order.currency,
  name: "RECLAIM",
  description:
    "RECLAIM Razorpay Test Payment",
  order_id: order.order.id,

        handler: async function (response: any) {
          const verifyResponse = await fetch(
            "/api/razorpay/verify",
            {
              method: "POST",
              headers: {
                "Content-Type":
                  "application/json",
              },
              body: JSON.stringify(response),
            },
          );

          if (!verifyResponse.ok) {
            alert(
              "Payment completed, but verification failed.",
            );
            return;
          }

          alert(
            "₹100 Razorpay Test Payment successful!",
          );
        },

        modal: {
          ondismiss: () => {
            setLoading(false);
          },
        },
      });

      razorpay.open();
    } catch (error) {
      console.error(error);

      alert(
        error instanceof Error
          ? error.message
          : "Payment initialization failed",
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <button
      type="button"
      className="button button-primary"
      onClick={handlePayment}
      disabled={loading}
    >
      {loading
        ? "Opening Razorpay..."
        : "Pay ₹100 with Razorpay →"}
    </button>
  );
}