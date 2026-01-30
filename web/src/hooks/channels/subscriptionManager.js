/**
 * Subscription management for WebSocket channels
 */

/**
 * Creates a subscription manager for tracking channel subscriptions
 */
export function createSubscriptionManager() {
  const subscriptions = new Set();
  const pendingSubscriptions = new Set();
  const pendingUnsubscriptions = new Set();

  /**
   * Add channels to subscribe to
   */
  function subscribe(channels) {
    const channelList = Array.isArray(channels) ? channels : [channels];
    const toSubscribe = [];

    for (const channel of channelList) {
      if (!subscriptions.has(channel) && !pendingSubscriptions.has(channel)) {
        pendingSubscriptions.add(channel);
        toSubscribe.push(channel);
      }
    }

    return toSubscribe;
  }

  /**
   * Confirm subscription was successful
   */
  function confirmSubscription(channels) {
    const channelList = Array.isArray(channels) ? channels : [channels];
    for (const channel of channelList) {
      pendingSubscriptions.delete(channel);
      subscriptions.add(channel);
    }
  }

  /**
   * Add channels to unsubscribe from
   */
  function unsubscribe(channels) {
    const channelList = Array.isArray(channels) ? channels : [channels];
    const toUnsubscribe = [];

    for (const channel of channelList) {
      if (subscriptions.has(channel) && !pendingUnsubscriptions.has(channel)) {
        pendingUnsubscriptions.add(channel);
        toUnsubscribe.push(channel);
      }
    }

    return toUnsubscribe;
  }

  /**
   * Confirm unsubscription was successful
   */
  function confirmUnsubscription(channels) {
    const channelList = Array.isArray(channels) ? channels : [channels];
    for (const channel of channelList) {
      pendingUnsubscriptions.delete(channel);
      subscriptions.delete(channel);
    }
  }

  /**
   * Get all current subscriptions (for reconnection)
   */
  function getActiveSubscriptions() {
    return Array.from(subscriptions);
  }

  /**
   * Check if subscribed to a channel
   */
  function isSubscribed(channel) {
    return subscriptions.has(channel);
  }

  /**
   * Clear all subscriptions (on disconnect)
   */
  function clearAll() {
    subscriptions.clear();
    pendingSubscriptions.clear();
    pendingUnsubscriptions.clear();
  }

  /**
   * Reset for reconnection (keep subscriptions but clear pending)
   */
  function resetForReconnect() {
    pendingSubscriptions.clear();
    pendingUnsubscriptions.clear();
  }

  return {
    subscribe,
    confirmSubscription,
    unsubscribe,
    confirmUnsubscription,
    getActiveSubscriptions,
    isSubscribed,
    clearAll,
    resetForReconnect,
  };
}
