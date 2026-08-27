<?php
/**
 * Thrown when a repository refuses an operation — ownership failure, unknown
 * record, or invalid state.
 *
 * Lives in its own file because it is thrown from every repository. Declaring
 * it inside one of them meant a throw from a sibling could trigger an autoload
 * for a file that does not exist.
 */

if (!defined('ABSPATH')) {
    exit;
}

class PTP_Repository_Exception extends RuntimeException
{
}
