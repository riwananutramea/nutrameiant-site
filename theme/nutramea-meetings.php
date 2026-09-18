<?php
/**
 * NutraMEA Intelligence — Member meetings.
 *
 * Adds "Meetings" to My Account: private, unlimited-length video calls that are
 * recorded in the member's own browser and saved to their own computer or their
 * own Google Drive.
 *
 * THIS IS NOT A PLUGIN. It is theme source code.
 *
 *   - No plugin header, so it never appears on the Plugins screen.
 *   - No activation or deactivation hook.
 *   - No custom database table, no custom post type, no admin screen.
 *   - One `require_once` line in functions.php turns it on. Deleting that line
 *     turns it off completely.
 *
 * Everything is configured from code, through a single filter, so the feature
 * lives in the repository and is reviewed like the rest of the theme rather
 * than drifting in a settings screen.
 *
 * COST: zero, permanently. The call runs on a public Jitsi deployment that
 * needs no account and no API key, and recording happens client-side. No code
 * path in this file or the app it loads can create a charge.
 *
 * INSTALL
 *   1. Copy this file to:            wp-content/themes/nutramea-theme/nutramea-meetings.php
 *   2. Copy the app folder to:       wp-content/themes/nutramea-theme/nutramea-meet/
 *      (the contents of site/meet/ — index.html plus assets/)
 *   3. Add to functions.php:         require_once get_stylesheet_directory() . '/nutramea-meetings.php';
 *   4. Visit Settings → Permalinks once and press Save, to register the endpoint.
 *
 * The page then appears at /my-account/meetings/ and in the My Account menu.
 *
 * @package NutraMEA
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

if ( ! class_exists( 'NutraMEA_Meetings' ) ) {

	/**
	 * Member meetings: routing, access control and app embedding.
	 */
	final class NutraMEA_Meetings {

		const VERSION       = '1.0.0';
		const ENDPOINT      = 'meetings';
		const APP_DIRECTORY = 'nutramea-meet';

		/**
		 * Singleton instance.
		 *
		 * @var NutraMEA_Meetings|null
		 */
		private static $instance = null;

		/**
		 * Boots the feature.
		 *
		 * @return NutraMEA_Meetings
		 */
		public static function instance() {
			if ( null === self::$instance ) {
				self::$instance = new self();
			}
			return self::$instance;
		}

		/**
		 * Registers hooks.
		 */
		private function __construct() {
			add_action( 'init', array( $this, 'register_endpoint' ) );
			add_filter( 'query_vars', array( $this, 'register_query_vars' ) );

			// WooCommerce My Account integration — the member's existing home.
			add_filter( 'woocommerce_account_menu_items', array( $this, 'add_account_menu_item' ) );
			add_action( 'woocommerce_account_' . self::ENDPOINT . '_endpoint', array( $this, 'render_account_page' ) );

			// Works without WooCommerce too.
			add_shortcode( 'nutramea_meetings', array( $this, 'render_shortcode' ) );

			add_action( 'wp_enqueue_scripts', array( $this, 'enqueue_assets' ) );
		}

		/* ---------------------------------------------------------- dashboard */

		/**
		 * Renders the My Account landing page.
		 *
		 * Called from the theme's `woocommerce/myaccount/dashboard.php`
		 * template, which REPLACES WooCommerce's own. Hooking onto
		 * `woocommerce_account_dashboard` instead would append to the stock
		 * "Hello {name}" boilerplate rather than replace it, leaving the page
		 * with two greetings.
		 *
		 * The secondary links are read from the live account menu, so this can
		 * never show a link to a section that does not exist, and never repeats
		 * the one already featured above it.
		 *
		 * @return string
		 */
		public function render_dashboard() {
			if ( ! is_user_logged_in() ) {
				return '';
			}

			$user  = wp_get_current_user();
			$first = $user->first_name ? $user->first_name : $user->display_name;

			$links = '';
			if ( function_exists( 'wc_get_account_menu_items' ) ) {
				// Excluded: this page itself, logout, and the featured card.
				$skip  = array( 'dashboard', 'customer-logout', self::ENDPOINT );
				$items = array_diff_key( wc_get_account_menu_items(), array_flip( $skip ) );
				foreach ( $items as $endpoint => $label ) {
					$links .= sprintf(
						'<a class="nutramea-dash__link" href="%s">%s</a>',
						esc_url( wc_get_account_endpoint_url( $endpoint ) ),
						esc_html( $label )
					);
				}
			}

			$meetings_url = function_exists( 'wc_get_account_endpoint_url' )
				? wc_get_account_endpoint_url( self::ENDPOINT )
				: home_url( '/my-account/' . self::ENDPOINT . '/' );

			$html = sprintf(
				'<div class="nutramea-dash">
					<p class="nutramea-dash__eyebrow">%1$s</p>
					<h2 class="nutramea-dash__greeting">%2$s</h2>

					<section class="nutramea-dash__feature">
						<h3>%3$s</h3>
						<p>%4$s</p>
						<a class="nutramea-dash__cta" href="%5$s">%6$s</a>
					</section>',
				esc_html__( 'Member dashboard', 'nutramea' ),
				/* translators: %s: member first name. */
				esc_html( sprintf( __( 'Hello, %s', 'nutramea' ), $first ) ),
				esc_html__( 'Meetings', 'nutramea' ),
				esc_html__( 'Private video calls with no time limit, recorded straight to your own computer. Notes, decisions and action items are written for you.', 'nutramea' ),
				esc_url( $meetings_url ),
				esc_html__( 'Start a meeting', 'nutramea' )
			);

			if ( '' !== $links ) {
				$html .= sprintf(
					'<nav class="nutramea-dash__links" aria-label="%s">%s</nav>',
					esc_attr__( 'Account sections', 'nutramea' ),
					$links
				);
			}

			return $html . '</div>';
		}

		/* ------------------------------------------------------------ routing */

		/**
		 * Registers the My Account endpoint.
		 */
		public function register_endpoint() {
			add_rewrite_endpoint( self::ENDPOINT, EP_ROOT | EP_PAGES );
		}

		/**
		 * Allows ?meeting=<slug> so an invite link can open a specific room.
		 *
		 * @param array $vars Registered query vars.
		 * @return array
		 */
		public function register_query_vars( $vars ) {
			$vars[] = 'meeting';
			return $vars;
		}

		/**
		 * Inserts "Meetings" into the My Account navigation.
		 *
		 * Placed before "Logout", which must stay last.
		 *
		 * @param array $items Existing menu items.
		 * @return array
		 */
		public function add_account_menu_item( $items ) {
			// Another part of the platform may already provide this entry.
			// Adding a second one would put "Meetings" in the menu twice.
			if ( isset( $items[ self::ENDPOINT ] ) ) {
				return $items;
			}

			$logout = null;
			if ( isset( $items['customer-logout'] ) ) {
				$logout = $items['customer-logout'];
				unset( $items['customer-logout'] );
			}

			$items[ self::ENDPOINT ] = __( 'Meetings', 'nutramea' );

			if ( null !== $logout ) {
				$items['customer-logout'] = $logout;
			}
			return $items;
		}

		/* ----------------------------------------------------------- settings */

		/**
		 * Client configuration handed to the app.
		 *
		 * Filterable so the deployment can be repointed — for example to a
		 * self-hosted meet.nutrameaint.com — without editing this file.
		 *
		 * Contains presentation settings only. Never put a secret here: it is
		 * visible to the browser by design.
		 *
		 * @return array
		 */
		public function get_client_config() {
			$config = array(
				'provider'  => 'jitsi',
				'jitsi'     => array(
					'domain'     => 'meet.jit.si',
					'roomPrefix' => 'NutraMEAInt',
				),
				'brandName' => get_bloginfo( 'name' ),
				'brandShort'=> 'NutraMEA Int.',
				// The surrounding My Account page already shows the logo, the
				// site name and a "Meetings" heading; the app drops its own.
				'embedded'  => true,
				'quality'   => 720,
				'notes'     => array(
					'enabled' => true,
					'engine'  => 'webspeech',
					'lang'    => str_replace( '_', '-', get_locale() ),
				),
				'storage'   => array(
					// Set this to enable one-click upload to the member's own
					// free Google Drive. Without it, recordings download to the
					// member's computer, which still costs nothing.
					'googleClientId' => '',
				),
			);

			/**
			 * Filters the meeting app configuration.
			 *
			 * @param array $config Client configuration.
			 */
			return apply_filters( 'nutramea_meetings_config', $config );
		}

		/**
		 * A stable, unguessable personal room for a member.
		 *
		 * Derived from the site's auth salt, so it cannot be predicted from the
		 * user ID, stays the same between visits, and never needs storing.
		 *
		 * @param int $user_id User ID.
		 * @return string
		 */
		public function personal_room( $user_id ) {
			$digest = hash_hmac( 'sha256', 'nutramea-room|' . (int) $user_id, wp_salt( 'auth' ) );
			return 'room-' . substr( $digest, 0, 20 );
		}

		/**
		 * URL of the embedded app, carrying room, name and configuration.
		 *
		 * @param int $user_id User ID.
		 * @return string
		 */
		public function app_url( $user_id ) {
			$requested = get_query_var( 'meeting' );
			$room      = is_string( $requested ) && '' !== $requested
				? sanitize_title( $requested )
				: $this->personal_room( $user_id );

			$user = get_userdata( $user_id );
			$name = $user ? $user->display_name : __( 'Member', 'nutramea' );

			$packed = rtrim(
				strtr( base64_encode( wp_json_encode( $this->get_client_config() ) ), '+/', '-_' ),
				'='
			);

			return add_query_arg(
				array(
					'room' => rawurlencode( $room ),
					'name' => rawurlencode( $name ),
					'cfg'  => $packed,
				),
				trailingslashit( get_stylesheet_directory_uri() ) . self::APP_DIRECTORY . '/index.html'
			);
		}

		/* ---------------------------------------------------------- rendering */

		/**
		 * Enqueues the wrapper stylesheet on pages that show the app.
		 */
		public function enqueue_assets() {
			if ( ! $this->is_meetings_context() ) {
				return;
			}
			wp_register_style( 'nutramea-meetings', false, array(), self::VERSION );
			wp_enqueue_style( 'nutramea-meetings' );
			wp_add_inline_style( 'nutramea-meetings', $this->wrapper_css() );
		}

		/**
		 * Whether the current request will render the meetings app.
		 *
		 * @return bool
		 */
		private function is_meetings_context() {
			global $wp_query;

			if ( isset( $wp_query->query_vars[ self::ENDPOINT ] ) ) {
				return true;
			}
			// The dashboard needs the same stylesheet.
			if ( function_exists( 'is_account_page' ) && is_account_page() ) {
				return true;
			}
			$post = get_post();
			return $post instanceof WP_Post && has_shortcode( (string) $post->post_content, 'nutramea_meetings' );
		}

		/**
		 * Styles for the embed wrapper only. The app styles itself.
		 *
		 * @return string
		 */
		private function wrapper_css() {
			return '
			.nutramea-dash{--nm-accent:#b9ff39;--nm-line:rgba(255,255,255,.1);
				--nm-muted:#9aa39c;--nm-surface:rgba(255,255,255,.02)}
			.nutramea-dash__eyebrow{display:flex;align-items:center;gap:.5rem;
				font-size:.6875rem;font-weight:650;letter-spacing:.09em;
				text-transform:uppercase;color:var(--nm-muted);margin:0 0 .75rem}
			.nutramea-dash__eyebrow:before{content:"";width:14px;height:2px;
				border-radius:1px;background:var(--nm-accent)}
			.nutramea-dash__greeting{font-size:1.5rem;font-weight:650;
				letter-spacing:-.02em;margin:0 0 1.75rem}
			.nutramea-dash__feature{border:1px solid var(--nm-line);border-radius:14px;
				padding:1.5rem;background:var(--nm-surface);margin-bottom:1.5rem}
			.nutramea-dash__feature h3{font-size:1.0625rem;font-weight:650;margin:0 0 .5rem}
			.nutramea-dash__feature p{margin:0 0 1.25rem;color:var(--nm-muted);
				font-size:.9375rem;line-height:1.6;max-width:56ch}
			.nutramea-dash__cta{display:inline-block;padding:.75rem 1.25rem;
				background:var(--nm-accent);color:#0a0c0b;border-radius:10px;
				font-weight:650;font-size:.9375rem;text-decoration:none}
			.nutramea-dash__cta:hover{background:#cbff6b;color:#0a0c0b}
			.nutramea-dash__links{display:flex;flex-wrap:wrap;gap:.5rem;
				padding-top:1.25rem;border-top:1px solid var(--nm-line)}
			.nutramea-dash__link{padding:.5rem .875rem;border:1px solid var(--nm-line);
				border-radius:8px;font-size:.8125rem;font-weight:600;
				color:inherit;text-decoration:none;opacity:.85}
			.nutramea-dash__link:hover{opacity:1;border-color:rgba(255,255,255,.22)}
			@media(max-width:620px){.nutramea-dash__cta{display:block;text-align:center}}
			.nutramea-meet{margin:0 0 1.5rem}
			.nutramea-meet__frame{width:100%;height:min(78vh,820px);min-height:560px;border:0;
				border-radius:12px;background:#0a0c0b;display:block}
			.nutramea-meet__note{margin-top:.75rem;font-size:.85rem;line-height:1.5;opacity:.75}
			.nutramea-meet__gate{padding:1.5rem;border:1px solid rgba(0,0,0,.12);border-radius:12px}
			@media(max-width:782px){.nutramea-meet__frame{height:min(72vh,640px);min-height:480px}}
			';
		}

		/**
		 * Renders the My Account → Meetings page.
		 */
		public function render_account_page() {
			// phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- escaped within.
			echo $this->render();
		}

		/**
		 * Shortcode handler.
		 *
		 * @return string
		 */
		public function render_shortcode() {
			return $this->render();
		}

		/**
		 * Builds the markup.
		 *
		 * @return string
		 */
		public function render() {
			if ( ! is_user_logged_in() ) {
				return sprintf(
					'<div class="nutramea-meet__gate"><p>%s</p><p><a class="button" href="%s">%s</a></p></div>',
					esc_html__( 'Meetings are available to NutraMEA members. Please sign in to continue.', 'nutramea' ),
					esc_url( wp_login_url( $this->current_url() ) ),
					esc_html__( 'Sign in', 'nutramea' )
				);
			}

			$user_id = get_current_user_id();

			return sprintf(
				'<div class="nutramea-meet">
					<iframe
						class="nutramea-meet__frame"
						src="%1$s"
						title="%2$s"
						allow="camera; microphone; display-capture; autoplay; clipboard-write; fullscreen; speaker-selection"
						allowfullscreen></iframe>
					<p class="nutramea-meet__note">%3$s</p>
				</div>',
				esc_url( $this->app_url( $user_id ) ),
				esc_attr__( 'NutraMEA member meeting', 'nutramea' ),
				esc_html__(
					'Your meeting room link is private to you. Recordings are made in your browser and saved to your own computer — nothing is stored on this website.',
					'nutramea'
				)
			);
		}

		/**
		 * Current request URL, used for the post-login redirect.
		 *
		 * @return string
		 */
		private function current_url() {
			$host = isset( $_SERVER['HTTP_HOST'] ) ? sanitize_text_field( wp_unslash( $_SERVER['HTTP_HOST'] ) ) : '';
			$uri  = isset( $_SERVER['REQUEST_URI'] ) ? sanitize_text_field( wp_unslash( $_SERVER['REQUEST_URI'] ) ) : '';
			if ( '' === $host || '' === $uri ) {
				return home_url( '/' );
			}
			return ( is_ssl() ? 'https://' : 'http://' ) . $host . $uri;
		}
	}

	NutraMEA_Meetings::instance();
}

/**
 * Flushes rewrite rules once, so /my-account/meetings/ resolves without the
 * operator having to remember to re-save permalinks.
 *
 * Rewrite flushing is expensive, so this runs a single time per version.
 */
add_action(
	'wp_loaded',
	function () {
		$flag = 'nutramea_meetings_rewrites';
		if ( get_option( $flag ) === NutraMEA_Meetings::VERSION ) {
			return;
		}
		flush_rewrite_rules( false );
		update_option( $flag, NutraMEA_Meetings::VERSION, false );
	}
);
