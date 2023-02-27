import {IOClients} from "@vtex/api";
import SchedulerClient from "./schedulerClient";

export class Clients extends IOClients{
    public get schedulerClient(){
        return this.getOrSet('schedulerClient',SchedulerClient)
    }
}
