<?php
/**
 * Test runner. Each suite runs in its own process so a fatal in one does not
 * mask the rest, and so method-level statics do not leak between suites.
 */

$suites = glob(__DIR__ . '/test-*.php');
$failed = 0;

foreach ($suites as $suite) {
    passthru(PHP_BINARY . ' ' . escapeshellarg($suite), $code);
    if ($code !== 0) { $failed++; }
}

echo "\n" . str_repeat('#', 62) . "\n";
printf("#  %d suite(s) run, %d failed\n", count($suites), $failed);
echo str_repeat('#', 62) . "\n";

exit($failed === 0 ? 0 : 1);
