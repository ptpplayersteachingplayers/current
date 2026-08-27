<?php
/**
 * PSR-ish autoloader for PTP classes.
 *
 * Replaces the 293 hand-written require_once calls in the old bootstrap.
 * Files follow WordPress naming: PTP_Bookings_Repository resolves to
 * class-ptp-bookings-repository.php, searched across the registered roots.
 */

if (!defined('ABSPATH')) {
    exit;
}

final class PTP_Autoloader
{
    /** @var array<int, array{root: string, prefix: string}> */
    private static array $roots = [];

    private static bool $registered = false;

    /** Register a directory tree to resolve $prefix-prefixed class names from. */
    public static function register(string $root, string $prefix = 'PTP_'): void
    {
        self::$roots[] = ['root' => trailingslashit($root), 'prefix' => $prefix];

        if (!self::$registered) {
            spl_autoload_register([__CLASS__, 'load']);
            self::$registered = true;
        }
    }

    public static function load(string $class): void
    {
        foreach (self::$roots as $entry) {
            if (strpos($class, $entry['prefix']) !== 0) {
                continue;
            }

            $file = 'class-' . str_replace('_', '-', strtolower($class)) . '.php';

            foreach (self::candidate_paths($entry['root'], $file) as $path) {
                if (is_readable($path)) {
                    require_once $path;

                    return;
                }
            }
        }
    }

    /**
     * Search the root and its immediate subdirectories. Deliberately shallow:
     * a class that cannot be found two levels down belongs somewhere else.
     *
     * @return array<int, string>
     */
    private static function candidate_paths(string $root, string $file): array
    {
        $paths = [$root . $file];

        foreach (glob($root . '*', GLOB_ONLYDIR) ?: [] as $dir) {
            $paths[] = trailingslashit($dir) . $file;
        }

        return $paths;
    }
}
