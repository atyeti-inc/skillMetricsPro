import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Endorsement, User } from "@shared/schema";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Trash2 } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { useAuth } from "@/hooks/use-auth";

interface EndorsementCardProps {
  endorsement: Endorsement;
  endorser: User;
  showSkillName?: boolean;
  skillName?: string;
}

export default function EndorsementCard({ 
  endorsement, 
  endorser, 
  showSkillName = false, 
  skillName 
}: EndorsementCardProps) {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [isDeleting, setIsDeleting] = useState(false);
  
  const deleteEndorsementMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("DELETE", `/api/endorsements/${endorsement.id}`);
    },
    onSuccess: () => {
      toast({
        title: "Endorsement deleted",
        description: "The endorsement has been removed",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/skills"] });
      queryClient.invalidateQueries({ queryKey: ["/api/user/endorsements"] });
      if (endorsement.skillId) {
        queryClient.invalidateQueries({ queryKey: ["/api/skills", endorsement.skillId, "endorsements"] });
      }
    },
    onError: (error: Error) => {
      toast({
        title: "Error deleting endorsement",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleDelete = () => {
    setIsDeleting(true);
    deleteEndorsementMutation.mutate();
  };

  return (
    <Card className="mb-4">
      <CardHeader className="pb-2 flex flex-row items-center justify-between">
        <div className="flex items-center space-x-2">
          <Avatar>
            <AvatarFallback>
              {endorser.firstName?.charAt(0) || endorser.email.charAt(0).toUpperCase()}
              {endorser.lastName?.charAt(0) || ""}
            </AvatarFallback>
          </Avatar>
          <div>
            <CardTitle className="text-base">
              {endorser.firstName && endorser.lastName 
                ? `${endorser.firstName} ${endorser.lastName}` 
                : endorser.email}
            </CardTitle>
            <p className="text-sm text-muted-foreground">
              {endorser.role || "Team Member"}
            </p>
          </div>
        </div>
        <div className="flex items-center space-x-2">
          {showSkillName && skillName && (
            <Badge variant="outline" className="font-normal">
              {skillName}
            </Badge>
          )}
          <div className="text-xs text-muted-foreground">
            {formatDistanceToNow(new Date(endorsement.createdAt), { addSuffix: true })}
          </div>
          {user?.is_admin && (
            <Button 
              variant="ghost" 
              size="icon" 
              className="h-8 w-8" 
              onClick={handleDelete}
              disabled={isDeleting}
            >
              <Trash2 className="h-4 w-4 text-destructive" />
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent>
        <p className="text-sm">
          {endorsement.comment || "Endorsed this skill"}
        </p>
      </CardContent>
    </Card>
  );
}