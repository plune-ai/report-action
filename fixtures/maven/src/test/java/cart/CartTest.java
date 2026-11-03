package cart;

import static org.junit.jupiter.api.Assertions.assertEquals;

import io.qameta.allure.Allure;
import org.junit.jupiter.api.Disabled;
import org.junit.jupiter.api.Test;

// One passes with a file, one fails, one is skipped.
class CartTest {
    @Test
    void addsAnItem() {
        Allure.addAttachment("cart", "text/plain", "cart: 1 item\n", ".txt");
    }

    @Test
    void totalIsWrong() {
        assertEquals(4, 3);
    }

    @Test
    @Disabled("not ready")
    void appliesACoupon() {
    }
}
