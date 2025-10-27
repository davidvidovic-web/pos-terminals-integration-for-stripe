<?php
// Exit if accessed directly
if (!defined('ABSPATH')) exit;
?>
<div class="wrap">
    <div class="stripe-terminal-admin-container">
        <div class="stripe-terminal-pos">
            <?php
            $wc_currency = get_woocommerce_currency();
            if (!$this->is_currency_supported($wc_currency)):
            ?>
                <div class="notice notice-error">
                    <p>
                        <strong>Warning:</strong> Your current WooCommerce currency (<?php echo esc_html($wc_currency); ?>)
                        is not supported by Stripe Terminal. Please change your WooCommerce currency to one of the following:
                        <?php echo esc_html(implode(', ', array_keys($this->supported_currencies))); ?>
                    </p>
                </div>
            <?php endif; ?>

            <div class="pos-section">
                <h3>📱 Select Terminal</h3>
                <button id="discover-terminals" class="button">🔍 Discover Terminals</button>
                <div class="terminal-list"></div>
            </div>

            <div class="pos-section">
                <h3>🛒 Payment Details</h3>

                <div class="form-row product-search-container">
                    <label for="product-search">Search Products</label>
                    <div class="product-search-controls">
                        <select id="product-search" class="product-search" style="width: 100%;">
                            <option value="">🔍 Search for a product...</option>
                            <?php
                            // Get WooCommerce products if WooCommerce is active
                            if (class_exists('WooCommerce')) {
                                $args = array(
                                    'status' => 'publish',
                                    'limit' => -1,
                                );
                                $products = wc_get_products($args);

                                // Generate product options with explicit escaping
                                foreach ($products as $product) {
                                    $product_id = absint($product->get_id());
                                    $product_price = $product->get_price();
                                    $product_name = $product->get_name();
                                    $price_display = wc_price($product_price);

                                    // Output with direct escaping - no variables in printf
                                    echo '<option value="' . esc_attr($product_id) . '" data-price="' . esc_attr($product_price) . '">';
                                    echo esc_html($product_name) . ' (' . esc_html(wp_strip_all_tags($price_display)) . ')';
                                    echo '</option>';
                                }
                            }
                            ?>
                        </select>
                        <button id="add-product" class="button">➕ Add Product</button>
                    </div>
                </div>

                <div class="cart-container">
                    <table id="cart-table" class="cart-table">
                        <thead>
                            <tr>
                                <th>Product</th>
                                <th>Price</th>
                                <th>Quantity</th>
                                <th>Total</th>
                                <th>Action</th>
                            </tr>
                        </thead>
                        <tbody>
                            <!-- Products will be added here dynamically -->
                        </tbody>
                        <tfoot>
                            <tr>
                                <td colspan="3">Subtotal</td>
                                <td id="subtotal">$0.00</td>
                                <td></td>
                            </tr>
                            <?php if (get_option('stripe_enable_tax', '0') === '1'): ?>
                                <tr id="tax-row">
                                    <td colspan="3"><span id="tax-rate-display">Sales Tax (<?php echo esc_html(get_option('stripe_sales_tax', '0')); ?>%)</span></td>
                                    <td id="tax">$0.00</td>
                                    <td></td>
                                </tr>
                            <?php endif; ?>
                            <tr class="total-row">
                                <td colspan="3"><strong>Total</strong></td>
                                <td id="total"><strong>$0.00</strong></td>
                                <td></td>
                            </tr>
                        </tfoot>
                    </table>
                </div>

                <div class="payment-info-container">
                    <div class="form-row">
                        <label for="payment-description">Additional Notes</label>
                        <input type="text" id="payment-description" placeholder="Additional notes about this order">
                    </div>
                    <div class="payment-button-container">
                        <button id="create-payment" class="button" disabled>💳 Create & Process Payment</button>
                    </div>
                </div>
            </div>

            <div class="pos-section">
                <h3>⚡ Process Payment</h3>
                
                <!-- Progress Bar -->
                <div class="payment-progress-container">
                    <div class="progress-steps">
                        <div class="progress-step" data-step="1">
                            <div class="step-circle">1</div>
                            <div class="step-label">Create Payment</div>
                        </div>
                        <div class="progress-line"></div>
                        <div class="progress-step" data-step="2">
                            <div class="step-circle">2</div>
                            <div class="step-label">Processing</div>
                        </div>
                        <div class="progress-line"></div>
                        <div class="progress-step" data-step="3">
                            <div class="step-circle">3</div>
                            <div class="step-label">Awaiting Customer</div>
                        </div>
                        <div class="progress-line"></div>
                        <div class="progress-step" data-step="4">
                            <div class="step-circle">4</div>
                            <div class="step-label">Complete</div>
                        </div>
                    </div>
                </div>

                <div id="payment-status"></div>
                <div class="button-group payment-controls" style="display: none;">
                    <button id="check-status" class="button">Check Status</button>
                    <button id="cancel-payment" class="button">Cancel Payment</button>
                </div>
            </div>
        </div>
    </div>

<!-- Enhanced Cancel Confirmation Modal -->
<div id="cancel-confirmation-modal" class="cancel-modal stripe-terminal-pos">
    <div class="cancel-modal-backdrop"></div>
    <div class="cancel-modal-content">
            <div class="cancel-modal-header">
                <h3><span class="cancel-icon">⚠️</span> Cancel Payment Transaction</h3>
            </div>
            <div class="cancel-modal-body">
                <p class="cancel-warning">Are you sure you want to cancel this payment? This action cannot be undone.</p>
                
                <div class="transaction-summary">
                    <h4>Transaction Details:</h4>
                    <div class="summary-content">
                        <div class="summary-row">
                            <span class="summary-label">Total Amount:</span>
                            <span class="summary-value" id="cancel-modal-amount">$0.00</span>
                        </div>
                        <div class="summary-row">
                            <span class="summary-label">Transaction Status:</span>
                            <span class="summary-value" id="cancel-modal-status">Processing</span>
                        </div>
                        <div class="summary-row">
                            <span class="summary-label">Items:</span>
                            <span class="summary-value" id="cancel-modal-items">0 items</span>
                        </div>
                    </div>
                </div>

                <div class="cancel-consequences">
                    <h4>What happens when you cancel:</h4>
                    <ul>
                        <li>The payment will be cancelled on Stripe</li>
                        <li>The terminal display will be cleared</li>
                        <li>No charges will be made to the customer</li>
                        <li>You'll need to start a new transaction</li>
                    </ul>
                </div>
            </div>
            <div class="cancel-modal-footer">
                <button id="cancel-modal-confirm" class="button-cancel-confirm">Yes, Cancel Payment</button>
                <button id="cancel-modal-close" class="button-cancel-close">Keep Processing</button>
            </div>
        </div>
    </div>
</div>