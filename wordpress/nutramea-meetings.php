<?php
/**
 * NutraMEA Intelligence — Member meetings.
 *
 * Adds "Meetings" to My Account: private, unlimited-length video calls that are
 * recorded in the member's own browser and saved to their own computer or their
 * own Google Drive.
 *
 * This is theme source, not a marketplace plugin, and it is deliberately
 * self-contained: one require line in functions.php turns it on, removing that
 * line turns it off, and it touches no database table.
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
