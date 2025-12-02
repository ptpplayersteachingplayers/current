<?php
/**
 * PTP Mobile API - Uninstall
 *
 * This file is called when the plugin is deleted from WordPress.
 * It removes all plugin data from the database.
 *
 * @package PTP_Mobile_API
 */

// If uninstall not called from WordPress, exit
if (!defined('WP_UNINSTALL_PLUGIN')) {
    exit;
}

global $wpdb;

// Remove the devices table
$table_name = $wpdb->prefix . 'ptp_mobile_devices';
$wpdb->query("DROP TABLE IF EXISTS {$table_name}");

// Remove plugin options
delete_option('ptp_mobile_api_db_version');

// Clear any transients we may have created
// (Add any transient cleanup here if needed in the future)
