import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { authClient } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";
import { motion, useReducedMotion } from "motion/react";

export const Route = createFileRoute("/login")({
  component: LoginPage,
});

const easeOutQuart = [0.25, 1, 0.5, 1] as const;

function LoginPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [isSignUp, setIsSignUp] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const shouldReduce = useReducedMotion();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);

    try {
      if (isSignUp) {
        await authClient.signUp.email({
          email,
          password,
          name: name || email.split("@")[0],
        });
        toast.success("Account created successfully");
      } else {
        await authClient.signIn.email({ email, password });
      }
      navigate({ to: "/events" });
    } catch (error) {
      const message = error instanceof Error ? error.message : undefined;
      if (isSignUp) {
        toast.error(message ?? "Could not create account. The email may already be registered.");
      } else {
        toast.error(message ?? "Incorrect email or password. Please try again.");
      }
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <motion.div
        className="w-full max-w-sm"
        initial={shouldReduce ? false : { opacity: 0, y: 16, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.5, ease: easeOutQuart }}
      >
        <Card className="shadow-card">
          <CardHeader className="text-center">
            <motion.div
              initial={shouldReduce ? false : { opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, delay: 0.15, ease: easeOutQuart }}
            >
              <CardTitle className="font-display text-2xl font-semibold">
                {isSignUp ? "Create Account" : "Sign In"}
              </CardTitle>
              <p className="mt-1 text-sm text-muted-foreground">EventArc Admin</p>
            </motion.div>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              {isSignUp && (
                <motion.div
                  initial={shouldReduce ? false : { opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: 0.25, ease: easeOutQuart }}
                >
                  <Input
                    type="text"
                    placeholder="Name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                  />
                </motion.div>
              )}
              <motion.div
                initial={shouldReduce ? false : { opacity: 0, x: -12 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.35, delay: 0.2, ease: easeOutQuart }}
              >
                <Input
                  type="email"
                  placeholder="Email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </motion.div>
              <motion.div
                initial={shouldReduce ? false : { opacity: 0, x: -12 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.35, delay: 0.3, ease: easeOutQuart }}
              >
                <Input
                  type="password"
                  placeholder="Password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={8}
                />
              </motion.div>
              <motion.div
                initial={shouldReduce ? false : { opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.35, delay: 0.4, ease: easeOutQuart }}
              >
                <Button type="submit" className="w-full" disabled={isLoading}>
                  {isLoading
                    ? "Loading..."
                    : isSignUp
                      ? "Create Account"
                      : "Sign In"}
                </Button>
              </motion.div>
            </form>
            <motion.div
              className="mt-4 text-center"
              initial={shouldReduce ? false : { opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.3, delay: 0.5 }}
            >
              <button
                type="button"
                className="text-sm text-muted-foreground transition-colors duration-200 hover:text-foreground"
                onClick={() => setIsSignUp(!isSignUp)}
              >
                {isSignUp
                  ? "Already have an account? Sign in"
                  : "Need an account? Sign up"}
              </button>
            </motion.div>
          </CardContent>
        </Card>
      </motion.div>
    </div>
  );
}
