<?php
/**
 * Thrown when a cart cannot be priced — empty cart, expired quote, or a quote
 * belonging to another account.
 *
 * Its own file so that a catch in the page layer resolves even when the
 * pricing engine itself has not been touched this request.
 */

if (!defined('ABSPATH')) {
    exit;
}

class PTP_Pricing_Exception extends RuntimeException
{
}
