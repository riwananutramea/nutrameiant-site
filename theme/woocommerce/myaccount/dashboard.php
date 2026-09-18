<?php
/**
 * My Account → Dashboard.
 *
 * Theme override of WooCommerce's `myaccount/dashboard.php`. WooCommerce loads
 * a template from the theme in preference to its own, which is the documented
 * way to replace this page — and the only way to replace rather than append to
 * it. Hooking `woocommerce_account_dashboard` would leave the stock
 * "Hello {name}" boilerplate in place above ours, so the page would greet the
 * member twice.
 *
 * All rendering lives in NutraMEA_Meetings so this file stays a thin seam.
 *
 * @package NutraMEA
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

if ( class_exists( 'NutraMEA_Meetings' ) ) {
	// Escaped at source, in render_dashboard().
	// phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped
	echo NutraMEA_Meetings::instance()->render_dashboard();
	return;
}

// Fallback if the meetings file was removed from functions.php: show the stock
// greeting rather than an empty page.
printf(
	'<p>%s</p>',
	sprintf(
		/* translators: 1: user display name 2: logout url */
		wp_kses_post( __( 'Hello %1$s (not %1$s? <a href="%2$s">Log out</a>)', 'woocommerce' ) ),
		'<strong>' . esc_html( wp_get_current_user()->display_name ) . '</strong>',
		esc_url( wc_logout_url() )
	)
);
