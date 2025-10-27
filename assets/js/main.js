jQuery(document).ready(function ($) {
  // Initialize global variables
  let selectedTerminal = null;
  let paymentIntentId = null;
  let clientSecret = null;
  let processingComplete = false;
  
  // Store step data for progress bar
  let stepData = {
    1: null,
    2: null,
    3: null,
    4: null
  };

  // Add near the beginning of the script
  if (!stripe_terminal_pos.currency_supported) {
    $("#create-payment").prop("disabled", true)
      .attr("title", "Currency not supported by Stripe Terminal");
  }

  // Handle tax enable/disable toggle
  $("#stripe_enable_tax").on("change", function () {
    const $taxRate = $("#stripe_sales_tax");
    const isEnabled = $(this).is(":checked");

    // Update the global tax settings
    stripe_terminal_pos.enable_tax = isEnabled;

    if (isEnabled) {
      $taxRate.prop("disabled", false);
      // Update the tax rate when enabled
      stripe_terminal_pos.sales_tax_rate = parseFloat($taxRate.val()) / 100;
    } else {
      $taxRate.prop("disabled", true);
      // Set tax rate to 0 when disabled
      stripe_terminal_pos.sales_tax_rate = 0;
    }

    // Update cart totals to reflect the new tax status
    updateCartTotals();
  });

  // Add handler for tax rate changes
  $("#stripe_sales_tax").on("change", function () {
    if ($("#stripe_enable_tax").is(":checked")) {
      stripe_terminal_pos.sales_tax_rate = parseFloat($(this).val()) / 100;
      updateCartTotals();
    }
  });

  // Initialize Select2
  $("#product-search").select2({
    placeholder: "Search for products...",
    allowClear: true,
  });

  // Helper function to format status text
  function formatStatus(status) {
    const statusMap = {
      'in_progress': 'In Progress',
      'requires_confirmation': 'Awaiting Confirmation',
      'requires_capture': 'Ready to Capture',
      'requires_payment_method': 'Awaiting Payment Method',
      'requires_action': 'Action Required',
      'processing': 'Processing',
      'succeeded': 'Succeeded',
      'canceled': 'Cancelled',
      'failed': 'Failed',
      'online': 'Online',
      'offline': 'Offline'
    };
    
    return statusMap[status] || status.charAt(0).toUpperCase() + status.slice(1).replace(/_/g, ' ');
  }

  // Helper function to get status icon
  function getStatusIcon(status) {
    const iconMap = {
      'in_progress': '⏳',
      'requires_confirmation': '🔔',
      'requires_capture': '💰',
      'requires_payment_method': '💳',
      'requires_action': '⚡',
      'processing': '🔄',
      'succeeded': '✅',
      'canceled': '🚫',
      'failed': '❌',
      'online': '🟢',
      'offline': '🔴'
    };
    
    return iconMap[status] || '📋';
  }

  // Helper function to update progress bar
  function updateProgressBar(step, state = 'active', data = null) {
    // Save step data if provided
    if (data) {
      stepData[step] = data;
      
      // Add tooltip to the step
      const $step = $(`.progress-step[data-step="${step}"]`);
      $step.addClass('has-data');
      
      // Remove existing tooltip if any
      $step.find('.step-data-tooltip').remove();
      
      // Create tooltip HTML
      let tooltipHtml = '<div class="step-data-tooltip">';
      tooltipHtml += '<h5>' + data.title + '</h5>';
      
      data.items.forEach(function(item) {
        tooltipHtml += '<div class="tooltip-row">';
        tooltipHtml += '<span class="tooltip-label">' + item.label + ':</span>';
        tooltipHtml += '<span class="tooltip-value">' + item.value + '</span>';
        tooltipHtml += '</div>';
      });
      
      tooltipHtml += '</div>';
      $step.append(tooltipHtml);
    }
    
    // Reset all steps
    $('.progress-step').removeClass('active completed error');
    $('.progress-line').removeClass('completed');
    
    // Update steps based on current step
    for (let i = 1; i <= 4; i++) {
      const $step = $(`.progress-step[data-step="${i}"]`);
      const $line = $step.next('.progress-line');
      
      if (i < step) {
        // Completed steps
        $step.addClass('completed');
        $line.addClass('completed');
      } else if (i === step) {
        // Current step
        $step.addClass(state);
      }
    }
    
    // Remove the fade effect - no longer needed
    $('.payment-progress-container').removeClass('waiting-pulse');
  }

  // Helper function to clear progress bar
  function clearProgressBar() {
    $('.progress-step').removeClass('active completed error has-data');
    $('.progress-line').removeClass('completed');
    $('.payment-progress-container').removeClass('waiting-pulse');
    $('.step-data-tooltip').remove();
    
    // Clear stored data
    stepData = {
      1: null,
      2: null,
      3: null,
      4: null
    };
  }
  
  // Handle clicks on progress steps to show data
  $(document).on('click', '.progress-step.has-data', function() {
    const step = $(this).data('step');
    const data = stepData[step];
    
    if (data) {
      // Toggle tooltip visibility
      const $tooltip = $(this).find('.step-data-tooltip');
      
      // Hide all other tooltips first
      $('.step-data-tooltip').removeClass('show');
      
      // Show this tooltip
      $tooltip.addClass('show');
      
      // Hide after 5 seconds
      setTimeout(function() {
        $tooltip.removeClass('show');
      }, 5000);
    }
  });
  
  // Close tooltip when clicking outside
  $(document).on('click', function(e) {
    if (!$(e.target).closest('.progress-step').length) {
      $('.step-data-tooltip').removeClass('show');
    }
  });

  // Helper function to create receipt-style display
  function createReceiptDisplay(title, status, items) {
    let html = '<div class="payment-receipt">';
    html += '<div class="receipt-header">';
    html += '<h4>' + title + '</h4>';
    html += '<div class="receipt-status">' + status + '</div>';
    html += '</div>';
    html += '<div class="receipt-body">';
    
    items.forEach(function(item) {
      html += '<div class="receipt-row">';
      html += '<span class="receipt-label">' + item.label + '</span>';
      html += '<span class="receipt-value">' + item.value + '</span>';
      html += '</div>';
    });
    
    html += '</div>';
    html += '</div>';
    
    return html;
  }

  // Automatically discover terminals when the page loads
  function autoDiscoverTerminals() {
    $("#discover-terminals")
      .text("🔍 Auto-discovering terminals...")
      .prop("disabled", true);
    $(".terminal-list").html("");

    $.ajax({
      url: stripe_terminal_pos.ajax_url,
      type: "POST",
      data: {
        action: "stripe_discover_readers",
        nonce: stripe_terminal_pos.nonce,
      },
      success: function (response) {
        $("#discover-terminals")
          .text("🔍 Discover Terminals")
          .prop("disabled", false);

        if (response.success && response.data.length > 0) {
          let readers = response.data;
          readers.forEach(function (reader, index) {
            const statusClass = reader.status === 'online' ? 'online' : 'offline';
            const formattedStatus = formatStatus(reader.status);
            const readerElement = $(
              '<div class="terminal-item" data-reader-id="' + reader.id + '">' +
                '<strong>' + reader.label + '</strong>' +
                '<div class="terminal-details">' +
                  '<span>Device: ' + reader.device_type + '</span>' +
                  '<span>ID: ' + reader.id.substring(0, 12) + '...</span>' +
                '</div>' +
                '<div class="terminal-status ' + statusClass + '">' +
                  formattedStatus +
                '</div>' +
              '</div>'
            );

            $(".terminal-list").append(readerElement);

            // Auto-select terminal only if the setting is enabled
            if (stripe_terminal_pos.auto_select_terminal) {
              if (index === 0 || reader.status === "online") {
                setTimeout(function () {
                  readerElement.trigger("click");
                }, 300);

                // If we found an online terminal, no need to check others
                if (reader.status === "online") {
                  return false; // Break the forEach loop
                }
              }
            }
          });
        } else {
          $(".terminal-list").html(
            "<p>No terminals found or error occurred.</p>"
          );
        }
      },
      error: function () {
        $("#discover-terminals")
          .text("🔍 Discover Terminals")
          .prop("disabled", false);
        $(".terminal-list").html("<p>Error connecting to server.</p>");
      },
    });
  }

  // Run auto-discovery on page load
  autoDiscoverTerminals();

  // Keep the manual discover button functionality
  $("#discover-terminals").on("click", function () {
    autoDiscoverTerminals();
  });

  // Select a terminal
  $(document).on("click", ".terminal-item", function () {
    $(".terminal-item").removeClass("selected");
    $(this).addClass("selected");
    selectedTerminal = $(this).data("reader-id");

    // Show a message that terminal is selected
    $("#payment-status").html(
      '<div class="status-message status-info">' +
      '<span class="status-icon">📱</span>' +
      '<strong>Terminal Selected</strong><br>' +
      'Ready to process payments with: ' + $(this).find("strong").text() +
      '</div>'
    );

    // Enable create payment if we have products in the cart
    updateCartTotals();
  });

  // 2. PRODUCT CART FUNCTIONALITY
  // Add product to cart
  $("#add-product").on("click", function () {
    const productSelect = $("#product-search");
    const productId = productSelect.val();

    if (!productId) {
      showEnhancedAlert("Please select a product first.", "warning");
      return;
    }

    const productName = productSelect
      .find("option:selected")
      .text()
      .split(" ($")[0];
    const productPrice = parseFloat(
      productSelect.find("option:selected").data("price")
    );

    // Check if product already exists in the cart
    const existingRow = $(`#product-${productId}`);
    if (existingRow.length > 0) {
      // Increment quantity if product exists
      const qtyInput = existingRow.find(".product-qty");
      qtyInput.val(parseInt(qtyInput.val()) + 1);
      qtyInput.trigger("change");
    } else {
      // Add new row if product doesn't exist
      const newRow = `
        <tr id="product-${productId}" data-product-id="${productId}" data-price="${productPrice.toFixed(2)}">
            <td>${productName}</td>
            <td>
                <span class="product-price">${formatCurrency(productPrice)}</span>
                <input type="hidden" value="${productPrice.toFixed(2)}">
            </td>
            <td>
                <input type="number" class="product-qty" min="1" value="1">
            </td>
            <td class="product-total">${formatCurrency(productPrice)}</td>
            <td><span class="remove-product">✕</span></td>
        </tr>
      `;

      $("#cart-table tbody").append(newRow);
    }

    // Clear the product selection
    productSelect.val("").trigger("change");

    // Update cart totals
    updateCartTotals();
  });

  // Update the quantity change handler
  $(document).on("change", ".product-qty", function () {
    const row = $(this).closest("tr");
    const price = parseFloat(row.data("price"));
    const qty = parseInt($(this).val());
    const total = price * qty;

    row.find(".product-total").text(formatCurrency(total));
    updateCartTotals();
  });

  // Remove product from cart
  $(document).on("click", ".remove-product", function () {
    $(this).closest("tr").remove();
    updateCartTotals();
  });

  // Update the formatCurrency function
  function formatCurrency(amount) {
    return stripe_terminal_pos.currency_symbol + amount.toFixed(2);
  }

  // Calculate cart totals
  function updateCartTotals() {
    let subtotal = 0;

    $("#cart-table tbody tr").each(function () {
        // Extract only numbers from the text, ignoring any currency symbol
        const rowTotal = parseFloat(
            $(this).find(".product-total").text().replace(/[^0-9.-]+/g, '')
        );
        subtotal += rowTotal;
    });

    const enableTax = stripe_terminal_pos.enable_tax;
    const taxRate = enableTax
        ? parseFloat(stripe_terminal_pos.sales_tax_rate)
        : 0;
    const tax = subtotal * taxRate;
    const total = subtotal + tax;

    $("#subtotal").text(formatCurrency(subtotal));

    // Tax calculations only if tax is enabled
    if (enableTax) {
        $("#tax").text(formatCurrency(tax));
    }

    $("#total").text(formatCurrency(total));

    // Update create payment button state
    if (subtotal > 0 && $(".terminal-item.selected").length > 0) {
        $("#create-payment").prop("disabled", false);
    } else {
        $("#create-payment").prop("disabled", true);
    }
  }

  // 3. PAYMENT PROCESSING
  // Update the create-payment click handler
  $("#create-payment").on("click", function () {
    if (!stripe_terminal_pos.currency_supported) {
      showEnhancedAlert("Your current WooCommerce currency is not supported by Stripe Terminal. " +
            "Supported currencies: " + stripe_terminal_pos.supported_currencies.join(", ").toUpperCase(), "error");
      return;
    }

    if ($(this).prop("disabled")) {
      return;
    }

    const selectedReader = $(".terminal-item.selected");
    if (selectedReader.length === 0) {
      showEnhancedAlert("Please select a terminal reader first.", "warning");
      return;
    }

    // Get the total amount from our cart
    const amount = parseFloat($("#total").text().replace(/[^0-9.-]+/g, ''));

    if (isNaN(amount) || amount <= 0) {
      showEnhancedAlert("Please add products to the cart first.", "warning");
      return;
    }

    // Disable all buttons during the full process and add processing state
    $("#create-payment")
      .text("🔄 Processing Payment...")
      .prop("disabled", true)
      .addClass("processing")
      .removeClass("success error");
    $("#discover-terminals").prop("disabled", true);

    // Format product information as a string for the payment description
    let productDetails = "PRODUCT | QTY | PRICE | TOTAL\n";
    productDetails += "--------------------------------\n";

    $("#cart-table tbody tr").each(function () {
      const productName = $(this).find("td:first").text();
      const price = $(this).find(".product-price").val();
      const qty = $(this).find(".product-qty").val();
      const total = parseFloat($(this).find(".product-total").text().replace(/[^0-9.-]+/g, ''));

      // Add each product row to the string using dynamic currency symbol
      productDetails += `${productName} | ${qty} | ${formatCurrency(parseFloat(price))} | ${formatCurrency(total)}\n`;
    });

    // Update summary information with dynamic currency
    productDetails += "--------------------------------\n";
    productDetails += `SUBTOTAL: ${subtotal}\n`;
    if (stripe_terminal_pos.enable_tax) {
        productDetails += `TAX (${(stripe_terminal_pos.sales_tax_rate * 100).toFixed(2)}%): ${tax}\n`;
    }
    productDetails += `TOTAL: ${total}\n`;

    // Get any additional notes
    const additionalNotes = $("<div>").text($("#payment-description").val()).html();

    // Update the productDetails display
    productDetails += "\nNOTES: " + additionalNotes.replace(/[<>]/g, '');

    $("#payment-status").html("<p>Step 1/2: Creating payment intent...</p>");
    
    // Update progress bar to step 1 with data
    const totalFormatted = formatCurrency(amount);
    const step1Data = {
      title: 'Creating Payment',
      items: [
        { label: 'Amount', value: totalFormatted },
        { label: 'Currency', value: stripe_terminal_pos.currency.toUpperCase() },
        { label: 'Status', value: 'Initializing...' }
      ]
    };
    updateProgressBar(1, 'active', step1Data);

    // Step 1: Create the payment intent
    $.ajax({
      url: stripe_terminal_pos.ajax_url,
      type: "POST",
      data: {
        action: "stripe_create_payment_intent",
        nonce: stripe_terminal_pos.nonce,
        amount: amount,
        currency: stripe_terminal_pos.currency.toLowerCase(),
        metadata: {
          description: productDetails,
        },
      },
      success: function (response) {
        if (response.success && response.data) {
          paymentIntentId = response.data.intent_id;
          clientSecret = response.data.client_secret;

          // Show the payment control buttons
          $(".payment-controls").show();
          $("#check-status, #cancel-payment").prop("disabled", false);

          // Get formatted total amount
          const totalAmount = formatCurrency(amount);
          
          // Create receipt-style display for step 1
          const receiptItems = [
            { label: 'Payment Intent ID', value: paymentIntentId.substring(0, 20) + '...' },
            { label: 'Amount', value: totalAmount },
            { label: 'Currency', value: stripe_terminal_pos.currency.toUpperCase() },
            { label: 'Status', value: 'Created' }
          ];
          
          $("#payment-status").html(createReceiptDisplay(
            'Payment Intent Created',
            'Step 1 of 4 - Ready to Process',
            receiptItems
          ));
          
          // Update progress bar to step 2 with data
          const step2Data = {
            title: 'Payment Intent Created',
            items: [
              { label: 'Intent ID', value: paymentIntentId.substring(0, 20) + '...' },
              { label: 'Amount', value: totalAmount },
              { label: 'Currency', value: stripe_terminal_pos.currency.toUpperCase() },
              { label: 'Status', value: 'Created' }
            ]
          };
          updateProgressBar(2, 'active', step2Data);

          // Process the payment
          processPaymentOnTerminal(
            selectedReader.data("reader-id"),
            paymentIntentId
          );
        } else {
          updateProgressBar(1, 'error');
          handlePaymentError("Error creating payment intent: " + response.data);
        }
      },
      error: function (xhr, status, error) {
        handlePaymentError("Server error while creating payment: " + error);
      },
    });
  });

  // Extract the process payment logic to a reusable function
  function processPaymentOnTerminal(readerId, paymentId) {
    $.ajax({
      url: stripe_terminal_pos.ajax_url,
      type: "POST",
      data: {
        action: "stripe_process_payment",
        nonce: stripe_terminal_pos.nonce,
        reader_id: readerId,
        payment_intent_id: paymentId,
      },
      success: function (response) {
        if (response.success) {
          const readerState = formatStatus(response.data.reader_state || 'processing');
          
          // Create receipt-style display for step 3 (awaiting customer)
          const terminalName = $(".terminal-item.selected strong").text() || 'Terminal';
          const receiptItems = [
            { label: 'Terminal', value: terminalName },
            { label: 'Reader State', value: readerState },
            { label: 'Payment ID', value: paymentId.substring(0, 20) + '...' },
            { label: 'Status', value: 'Waiting for Customer' }
          ];
          
          $("#payment-status").html(createReceiptDisplay(
            'Awaiting Customer Payment',
            'Step 3 of 4 - Awaiting Customer',
            receiptItems
          ));
          
          // Update progress bar to step 3 (Awaiting Customer) with data
          const step3Data = {
            title: 'Awaiting Customer',
            items: [
              { label: 'Terminal', value: terminalName },
              { label: 'Reader State', value: readerState },
              { label: 'Payment ID', value: paymentId.substring(0, 20) + '...' },
              { label: 'Status', value: 'Waiting for Card' }
            ]
          };
          updateProgressBar(3, 'active', step3Data);

          // Update button to show waiting for customer with spinner
          $("#create-payment")
            .text("Waiting for Customer...")
            .removeClass("processing success error")
            .addClass("processing waiting");

          // Start automatic status checking
          startStatusChecking(paymentId);
        } else {
          updateProgressBar(2, 'error');
          handlePaymentError("Error processing payment: " + response.data);
        }
      },
      error: function (xhr, status, error) {
        handlePaymentError("Server error while processing payment: " + error);
      },
    });
  }

  // Error handling helper
  function handlePaymentError(message) {
    $("#payment-status").html(
      '<div class="status-message status-error">' +
      '<span class="status-icon">❌</span>' +
      '<strong>Payment Error</strong><br>' +
      message +
      '</div>'
    );
    $("#create-payment")
      .text("💳 Create & Process Payment")
      .prop("disabled", false)
      .removeClass("processing success")
      .addClass("error");
    
    // Remove error class after 3 seconds
    setTimeout(function() {
      $("#create-payment").removeClass("error");
    }, 3000);
    
    $("#discover-terminals").prop("disabled", false);
  }

  // Auto-check payment status every few seconds
  function startStatusChecking(paymentId) {
    let checkCount = 0;
    const statusInterval = setInterval(function () {
      if (processingComplete || checkCount >= 30) {
        // Limit to 30 checks (about 2-3 minutes)
        clearInterval(statusInterval);
        if (checkCount >= 30 && !processingComplete) {
          $("#payment-status").append(
            "<p>Status checking timed out. Please use the Check Status button.</p>"
          );
        }
        return;
      }

      checkCount++;
      checkPaymentStatus(paymentId);
    }, 5000); // Check every 5 seconds
  }

  // Check payment status
  function checkPaymentStatus(paymentId) {
    const cartItems = [];
    $("#cart-table tbody tr").each(function() {
        cartItems.push({
            product_id: $(this).data('product-id'),
            price: $(this).data('price'),
            quantity: parseInt($(this).find('.product-qty').val()),
            total: parseFloat($(this).find(".product-total").text().replace(/[^0-9.-]+/g, ''))
        });
    });

    $.ajax({
      url: stripe_terminal_pos.ajax_url,
      type: "POST",
      data: {
        action: "stripe_check_payment_status",
        nonce: stripe_terminal_pos.nonce,
        payment_intent_id: paymentId,
        cart_items: JSON.stringify(cartItems),
        tax: parseFloat($("#tax").text().replace(/[^0-9.-]+/g, '')),
        notes: $("#payment-description").val(),
        reader_id: $(".terminal-item.selected").data("reader-id")
      },
      success: function(response) {
        if (response.success) {
          const status = response.data.status;
          const formattedStatus = formatStatus(status);
          const statusIcon = getStatusIcon(status);

          if (status === "succeeded") {
            processingComplete = true;
            const orderMessage = response.data.order_id ? 
                `<br>WooCommerce Order Created: #${response.data.order_id}` : '';

            // Update progress bar to step 4 (Complete) with data
            const step4Data = {
              title: 'Payment Complete',
              items: [
                { label: 'Amount', value: formatCurrency(response.data.amount) },
                { label: 'Currency', value: response.data.currency.toUpperCase() },
                { label: 'Status', value: formattedStatus }
              ]
            };
            
            if (response.data.order_id) {
              step4Data.items.push({ label: 'Order ID', value: '#' + response.data.order_id });
            }
            
            updateProgressBar(4, 'completed', step4Data);

            $("#payment-status").html(
              '<div class="status-message status-success">' +
              '<span class="status-icon">' + statusIcon + '</span>' +
              '<strong>Payment Successful!</strong><br>' +
              'Amount: ' + formatCurrency(response.data.amount) + '<br>' +
              'Status: ' + formattedStatus +
              orderMessage +
              '</div>'
            );

            // Update the payment result display
            $("#payment-result").html(
              "<h3>Payment Successful!</h3>" +
                "<p>Amount: " +
                formatCurrency(response.data.amount) +
                "</p>" +
                "<p>Currency: " +
                response.data.currency.toUpperCase() +
                "</p>" +
                "<p>Status: " +
                formattedStatus +
                "</p>"
            );

            // Reset for new payment with success state
            $("#create-payment")
              .text("✅ Payment Complete!")
              .prop("disabled", false)
              .removeClass("processing error")
              .addClass("success");
            
            // Reset button text and clear progress after 3 seconds
            setTimeout(function() {
              $("#create-payment")
                .text("💳 Create & Process Payment")
                .removeClass("success");
              clearProgressBar();
            }, 3000);
            
            $("#discover-terminals").prop("disabled", false);
            $("#check-status").prop("disabled", true);
            $("#cancel-payment").prop("disabled", true);

            // Clear cart for new order
            $("#cart-table tbody").empty();
            updateCartTotals();
          } else if (
            status === "requires_confirmation" ||
            status === "requires_capture" ||
            status === "processing" ||
            status === "in_progress"
          ) {
            $("#payment-status").html(
              '<div class="status-message status-info">' +
              '<span class="status-icon">' + statusIcon + '</span>' +
              '<strong>Processing Payment</strong><br>' +
              'Status: ' + formattedStatus + '<br>' +
              'Please wait while the payment is being processed...' +
              '</div>'
            );
          } else if (status === "canceled") {
            processingComplete = true;
            
            // Clear progress bar on cancel
            setTimeout(function() {
              clearProgressBar();
            }, 2000);
            
            $("#payment-status").html(
              '<div class="status-message status-warning">' +
              '<span class="status-icon">⚠️</span>' +
              '<strong>Payment Cancelled</strong><br>' +
              'The payment was cancelled and no charges were made.' +
              '</div>'
            );
            $("#create-payment")
              .text("💳 Create & Process Payment")
              .prop("disabled", false)
              .removeClass("processing success error");
            $("#discover-terminals").prop("disabled", false);
          } else if (status === "failed") {
            processingComplete = true;
            
            // Clear progress bar on failure
            setTimeout(function() {
              clearProgressBar();
            }, 2000);
          }
        }
      },
      error: function () {
        // Don't show errors during automatic checking
      },
    });
  }

  // Enhanced Cancel payment with modal
  $("#cancel-payment").on("click", function () {
    if (!paymentIntentId) {
      showEnhancedAlert("No active payment intent.", "warning");
      return;
    }

    // Populate modal with current transaction details
    populateCancelModal();
    $("#cancel-confirmation-modal").addClass("is-visible");
  });

  // Modal event handlers
  $("#cancel-modal-close").on("click", function () {
    $("#cancel-confirmation-modal").removeClass("is-visible");
  });

  $("#cancel-modal-confirm").on("click", function () {
    $("#cancel-confirmation-modal").removeClass("is-visible");
    performCancellation();
  });

  // Close modal with ESC key  
  $(document).on("keydown", function(e) {
    if (e.key === "Escape" && $("#cancel-confirmation-modal").hasClass("is-visible")) {
      $("#cancel-confirmation-modal").removeClass("is-visible");
    }
  });

  // Function to populate the cancel modal with transaction details
  function populateCancelModal() {
    const totalAmount = $("#total").text();
    const subtotalAmount = $("#subtotal").text();
    const taxAmount = $("#tax").length ? $("#tax").text() : "$0.00";
    const itemCount = $("#cart-table tbody tr").length;
    
    // Update basic transaction info
    $("#cancel-modal-amount").text(totalAmount);
    $("#cancel-modal-items").text(itemCount + " item" + (itemCount !== 1 ? "s" : ""));
    $("#cancel-modal-status").text(formatStatus("processing"));

    // Create detailed product list
    let productDetails = '<div class="modal-product-list">';
    $("#cart-table tbody tr").each(function() {
      const productName = $(this).find("td:first").text();
      const quantity = $(this).find(".product-qty").val();
      const total = $(this).find(".product-total").text();
      
      productDetails += 
        '<div class="modal-product-item">' +
        '<span class="modal-product-name">' + productName + '</span>' +
        '<span class="modal-product-details">Qty: ' + quantity + ' - ' + total + '</span>' +
        '</div>';
    });
    productDetails += '</div>';

    // Add or update the product details in the modal
    if ($(".modal-product-list").length) {
      $(".modal-product-list").replaceWith(productDetails);
    } else {
      $(".transaction-summary .summary-content").after(productDetails);
    }

    // Update the summary with more details
    const additionalSummary = 
      '<div class="summary-row">' +
      '<span class="summary-label">Subtotal:</span>' +
      '<span class="summary-value">' + subtotalAmount + '</span>' +
      '</div>' +
      (stripe_terminal_pos.enable_tax ? 
        '<div class="summary-row">' +
        '<span class="summary-label">Tax:</span>' +
        '<span class="summary-value">' + taxAmount + '</span>' +
        '</div>' : '');

    // Add additional summary if not already present
    if (!$(".cancel-modal-subtotal").length) {
      $(".summary-content").append('<div class="cancel-modal-subtotal">' + additionalSummary + '</div>');
    }
  }

  // Function to perform the actual cancellation
  function performCancellation() {
    const $cancelBtn = $("#cancel-payment");
    
    // Add loading state to cancel button
    $cancelBtn.addClass("loading").text("Cancelling...").prop("disabled", true);
    
    $("#payment-status").html(
      '<div class="status-message status-warning">' +
      '<span class="status-icon">⏳</span>' +
      '<strong>Cancelling Payment</strong><br>' +
      'Cancelling payment and clearing terminal...' +
      '</div>'
    );

    // First, cancel the payment intent on Stripe's servers
    $.ajax({
      url: stripe_terminal_pos.ajax_url,
      type: "POST",
      data: {
        action: "stripe_cancel_payment",
        nonce: stripe_terminal_pos.nonce,
        payment_intent_id: paymentIntentId,
      },
      success: function (response) {
        if (response.success) {
          // Update status to show clearing terminal
          $("#payment-status").html(
            '<div class="status-message status-info">' +
            '<span class="status-icon">🔄</span>' +
            '<strong>Clearing Terminal</strong><br>' +
            'Payment cancelled successfully. Clearing terminal display...' +
            '</div>'
          );
          
          // Clear progress bar after 2 seconds
          setTimeout(function() {
            clearProgressBar();
          }, 2000);
          
          // Now clear the terminal display
          clearTerminalDisplay();
        } else {
          $cancelBtn.removeClass("loading").text("Cancel Payment").prop("disabled", false);
          $("#payment-status").html(
            '<div class="status-message status-error">' +
            '<span class="status-icon">❌</span>' +
            '<strong>Cancellation Failed</strong><br>' +
            'Error cancelling payment: ' + response.data +
            '</div>'
          );
        }
      },
      error: function () {
        $cancelBtn.removeClass("loading").text("Cancel Payment").prop("disabled", false);
        $("#payment-status").html(
          '<div class="status-message status-error">' +
          '<span class="status-icon">❌</span>' +
          '<strong>Connection Error</strong><br>' +
          'Error connecting to server while cancelling payment.' +
          '</div>'
        );
      },
    });
  }

  // New function to clear the terminal display
  function clearTerminalDisplay() {
    const selectedReader = $(".terminal-item.selected");
    if (selectedReader.length === 0) {
      finalizeCancellation();
      return;
    }

    const readerId = selectedReader.data("reader-id");

    $.ajax({
      url: stripe_terminal_pos.ajax_url,
      type: "POST",
      data: {
        action: "stripe_clear_terminal",
        nonce: stripe_terminal_pos.nonce,
        reader_id: readerId,
      },
      success: function (response) {
        if (response.success) {
          $("#payment-status").html(
            '<div class="status-message status-success">' +
            '<span class="status-icon">✅</span>' +
            '<strong>Terminal Cleared</strong><br>' +
            'Payment cancelled and terminal display cleared successfully.' +
            '</div>'
          );
        } else {
          $("#payment-status").html(
            '<div class="status-message status-warning">' +
            '<span class="status-icon">⚠️</span>' +
            '<strong>Payment Cancelled</strong><br>' +
            'The payment was cancelled, but the terminal display could not be cleared. ' +
            'The terminal may still show the payment screen.' +
            '</div>'
          );
        }
        finalizeCancellation();
      },
      error: function () {
        $("#payment-status").html(
          '<div class="status-message status-warning">' +
          '<span class="status-icon">⚠️</span>' +
          '<strong>Payment Cancelled</strong><br>' +
          'The payment was cancelled, but there was an error clearing the terminal display. ' +
          'The terminal may still show the payment screen.' +
          '</div>'
        );
        finalizeCancellation();
      },
    });
  }

  // Helper function to finalize the cancellation process
  function finalizeCancellation() {
    const $cancelBtn = $("#cancel-payment");
    $cancelBtn.removeClass("loading").text("Cancel Payment").prop("disabled", false);
    
    $("#payment-status").html(
      '<div class="status-message status-success">' +
      '<span class="status-icon">✅</span>' +
      '<strong>Payment Cancelled Successfully</strong><br>' +
      'The payment has been cancelled and the terminal has been cleared.' +
      '</div>'
    );

    // Reset for new payment
    paymentIntentId = null;
    clientSecret = null;
    processingComplete = true;

    // Hide payment controls
    $(".payment-controls").hide();
    
    $("#create-payment")
      .text("💳 Create & Process Payment")
      .prop("disabled", false)
      .removeClass("processing success error");
    $("#discover-terminals").prop("disabled", false);
  }

  // Enhanced alert function for better user notifications
  function showEnhancedAlert(message, type = 'info') {
    const iconMap = {
      'success': '✅',
      'error': '❌',
      'warning': '⚠️',
      'info': 'ℹ️'
    };

    const alertHtml = 
      '<div class="status-message status-' + type + '">' +
      '<span class="status-icon">' + iconMap[type] + '</span>' +
      '<strong>' + message + '</strong>' +
      '</div>';

    $("#payment-status").html(alertHtml);

    // Auto-fade after 5 seconds for non-error messages
    if (type !== 'error') {
      setTimeout(function() {
        $("#payment-status .status-message").fadeOut(1000);
      }, 5000);
    }
  }

  // Only change the Create Payment button text to make it clear it's an all-in-one action
  $("#create-payment").text("💳 Create & Process Payment");

  // Add click handler for check status button
  $("#check-status").on("click", function() {
    if (!paymentIntentId) {
        showEnhancedAlert("No active payment to check.", "warning");
        return;
    }
    $(this).prop("disabled", true);
    checkPaymentStatus(paymentIntentId);
    setTimeout(() => $(this).prop("disabled", false), 2000); // Re-enable after 2s
});
});
