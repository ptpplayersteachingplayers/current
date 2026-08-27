<?php
/**
 * Thrown when the payment provider rejects a call or is unreachable.
 */

if (!defined('ABSPATH')) {
    exit;
}

class PTP_Stripe_Exception extends RuntimeException
{
}
